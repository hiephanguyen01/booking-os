import { createHash, randomUUID } from "node:crypto";

import {
  createSessionToken,
  deriveSessionSecretDigest,
  parseSessionToken,
  verifySessionSecretDigest,
} from "@booking-os/auth";
import { Inject, Injectable } from "@nestjs/common";

import { EnvironmentService } from "../../../../../config/environment.service.js";
import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  RefreshSessionAuthorizationInput,
  RevokeStaleAuthorizationSessionInput,
  SessionAuthorizationRefreshPort,
  SessionAuthorizationRotationResult,
  SessionAuthorizationScope,
} from "../../../application/ports/session-authorization-refresh.port.js";

const OVERLAP_MS = 30 * 1000;

interface LockedAuthorizationSessionRow {
  readonly tokenId: string;
  readonly tokenHash: string;
  readonly scopeType: "platform" | "tenant";
  readonly tenantId: string | null;
  readonly absoluteExpiresAt: Date;
  readonly replacedAt: Date | null;
  readonly authorizationVersion: number;
  readonly membershipAuthorizationVersion: number | null;
}

function deriveDigestKey(secret: string): Uint8Array {
  return createHash("sha256")
    .update("booking-os/session-token-digest/v1\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

async function assumeScopedDatabaseRole(
  transaction: Parameters<Parameters<PrismaService["$transaction"]>[0]>[0],
  scope: SessionAuthorizationScope,
): Promise<void> {
  if (scope.type === "platform") {
    await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_platform_app");
    return;
  }

  await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
  await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${scope.tenantId}, true)`;
}

@Injectable()
export class PrismaSessionAuthorizationRefreshAdapter implements SessionAuthorizationRefreshPort {
  private readonly digestKey: Uint8Array;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EnvironmentService) environment: EnvironmentService,
  ) {
    this.digestKey = deriveDigestKey(environment.sessionSecret);
  }

  async refreshAndRotate(
    input: RefreshSessionAuthorizationInput,
  ): Promise<SessionAuthorizationRotationResult> {
    const presented = parseSessionToken(input.presentedToken);
    if (!presented) throw new Error("Presented authorization session token is invalid.");
    const rawSuccessor = createSessionToken();
    const successor = parseSessionToken(rawSuccessor);
    if (!successor) throw new TypeError("Session token factory returned an invalid token.");
    const now = new Date();

    await this.prisma.$transaction(async (transaction) => {
      await assumeScopedDatabaseRole(transaction, input.scope);
      const rows = await transaction.$queryRawUnsafe<readonly LockedAuthorizationSessionRow[]>(
        `SELECT
           token."id" AS "tokenId",
           token."token_hash" AS "tokenHash",
           session."scope_type"::text AS "scopeType",
           session."tenant_id" AS "tenantId",
           session."absolute_expires_at" AS "absoluteExpiresAt",
           token."replaced_at" AS "replacedAt",
           session."authorization_version" AS "authorizationVersion",
           session."membership_authorization_version" AS "membershipAuthorizationVersion"
         FROM "auth_session_tokens" AS token
         INNER JOIN "auth_sessions" AS session ON session."id" = token."session_id"
         WHERE token."selector" = $1
           AND session."id" = $2::uuid
           AND session."user_id" = $3::uuid
           AND session."state" = 'active'
           AND session."revoked_at" IS NULL
           AND session."compromised_at" IS NULL
           AND session."absolute_expires_at" > $4::timestamptz
           AND token."expires_at" > $4::timestamptz
           AND token."revoked_at" IS NULL
         FOR UPDATE OF token, session`,
        presented.selector,
        input.sessionId,
        input.userId,
        now,
      );
      const current = rows[0];
      if (
        !current ||
        rows.length !== 1 ||
        current.replacedAt !== null ||
        !verifySessionSecretDigest({
          digestKey: this.digestKey,
          secret: presented.secret,
          expectedDigest: current.tokenHash,
        }) ||
        (current.scopeType === "platform" && input.membershipAuthorizationVersion !== undefined) ||
        (current.scopeType === "tenant" && input.membershipAuthorizationVersion === undefined) ||
        current.scopeType !== input.scope.type ||
        (input.scope.type === "tenant" && current.tenantId !== input.scope.tenantId)
      ) {
        throw new Error("Authorization session is unavailable for rotation.");
      }

      const created = await transaction.authSessionToken.create({
        data: {
          id: randomUUID(),
          sessionId: input.sessionId,
          scopeType: current.scopeType,
          tenantId: current.tenantId,
          selector: successor.selector,
          tokenHash: deriveSessionSecretDigest({
            digestKey: this.digestKey,
            secret: successor.secret,
          }),
          issuedAt: now,
          expiresAt: current.absoluteExpiresAt,
          replacedAt: now,
          overlapUntil: now,
          successorTokenId: null,
          reuseDetectedAt: null,
          revokedAt: null,
        },
      });
      await transaction.authSessionToken.update({
        where: { id: current.tokenId },
        data: {
          replacedAt: now,
          overlapUntil: new Date(now.getTime() + OVERLAP_MS),
          successorTokenId: created.id,
        },
      });
      await transaction.authSessionToken.update({
        where: { id: created.id },
        data: { replacedAt: null, overlapUntil: null },
      });
      await transaction.authSession.update({
        where: { id: input.sessionId },
        data: {
          authorizationVersion: input.userAuthorizationVersion,
          membershipAuthorizationVersion: input.membershipAuthorizationVersion ?? null,
          version: { increment: 1 },
          updatedAt: now,
        },
      });
    });

    return Object.freeze({ successorToken: rawSuccessor });
  }

  async revoke(input: RevokeStaleAuthorizationSessionInput): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      await assumeScopedDatabaseRole(transaction, input.scope);
      const revoked = await transaction.authSession.updateMany({
        where: { id: input.sessionId, userId: input.userId, revokedAt: null },
        data: {
          state: "revoked",
          revokedAt: now,
          revocationReason: input.reason,
          version: { increment: 1 },
          updatedAt: now,
        },
      });
      if (revoked.count > 0) {
        await transaction.authSessionToken.updateMany({
          where: { sessionId: input.sessionId, revokedAt: null },
          data: { revokedAt: now },
        });
      }
    });
  }
}
