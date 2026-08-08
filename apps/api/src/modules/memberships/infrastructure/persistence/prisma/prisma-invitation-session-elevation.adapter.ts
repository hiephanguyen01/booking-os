import { randomUUID } from "node:crypto";

import { createSessionToken, deriveSessionSecretDigest, parseSessionToken } from "@booking-os/auth";
import type { Prisma } from "@prisma/client";

import type {
  ElevateInvitationSessionInput,
  SessionElevationPort,
  SessionElevationResult,
} from "../../../application/ports/session-elevation.port.js";

const LOCK_INVITATION_SESSION_SQL = `
  SELECT
    "id",
    "absolute_expires_at" AS "absoluteExpiresAt"
  FROM "auth_sessions"
  WHERE "tenant_id" = $1::uuid
    AND "id" = $2::uuid
    AND "scope_type" = 'tenant'
    AND "state" = 'invitation_pending'
    AND "revoked_at" IS NULL
    AND "compromised_at" IS NULL
    AND "idle_expires_at" > $3::timestamptz
    AND "absolute_expires_at" > $3::timestamptz
  FOR UPDATE
`;

const ACTIVATE_INVITATION_SESSION_SQL = `
  UPDATE "auth_sessions"
  SET
    "state" = 'active',
    "authorization_version" = $3::integer,
    "version" = "version" + 1,
    "last_seen_at" = $4::timestamptz,
    "updated_at" = $4::timestamptz
  WHERE "tenant_id" = $1::uuid
    AND "id" = $2::uuid
    AND "state" = 'invitation_pending'
    AND "revoked_at" IS NULL
`;

const REVOKE_INVITATION_SESSION_TOKENS_SQL = `
  UPDATE "auth_session_tokens"
  SET "revoked_at" = $3::timestamptz
  WHERE "tenant_id" = $1::uuid
    AND "session_id" = $2::uuid
    AND "revoked_at" IS NULL
`;

const INSERT_ROTATED_SESSION_TOKEN_SQL = `
  INSERT INTO "auth_session_tokens" (
    "id",
    "session_id",
    "scope_type",
    "tenant_id",
    "selector",
    "token_hash",
    "issued_at",
    "expires_at",
    "replaced_at",
    "overlap_until",
    "successor_token_id",
    "reuse_detected_at",
    "revoked_at"
  )
  VALUES (
    $1::uuid,
    $2::uuid,
    'tenant',
    $3::uuid,
    $4,
    $5,
    $6::timestamptz,
    $7::timestamptz,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  )
`;

interface LockedInvitationSessionRow {
  readonly id: string;
  readonly absoluteExpiresAt: Date;
}

export interface PrismaInvitationSessionElevationOptions {
  readonly digestKey: Uint8Array;
  readonly idFactory?: () => string;
  readonly tokenFactory?: () => string;
}

export class PrismaInvitationSessionElevationAdapter implements SessionElevationPort {
  private readonly idFactory: () => string;
  private readonly tokenFactory: () => string;

  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly tenantId: string,
    private readonly options?: PrismaInvitationSessionElevationOptions,
  ) {
    this.idFactory = options?.idFactory ?? randomUUID;
    this.tokenFactory = options?.tokenFactory ?? (() => createSessionToken());
  }

  async elevateInvitationSession(
    input: ElevateInvitationSessionInput,
  ): Promise<SessionElevationResult> {
    if (!this.options) {
      throw new Error("Invitation session elevation security configuration is unavailable.");
    }
    if (
      !Number.isInteger(input.membershipAuthorizationVersion) ||
      input.membershipAuthorizationVersion <= 0
    ) {
      throw new TypeError("Membership authorization version must be a positive integer.");
    }

    const rows = await this.transaction.$queryRawUnsafe<LockedInvitationSessionRow[]>(
      LOCK_INVITATION_SESSION_SQL,
      this.tenantId,
      input.sessionId,
      input.now,
    );
    const lockedSession = rows[0];

    if (!lockedSession || rows.length !== 1) {
      throw new Error("Invitation-pending session is unavailable.");
    }

    const rotatedToken = this.tokenFactory();
    const parsedToken = parseSessionToken(rotatedToken);
    if (!parsedToken) {
      throw new TypeError("Token factory returned an invalid session token.");
    }

    const sessionUpdateCount = await this.transaction.$executeRawUnsafe(
      ACTIVATE_INVITATION_SESSION_SQL,
      this.tenantId,
      input.sessionId,
      input.membershipAuthorizationVersion,
      input.now,
    );
    if (sessionUpdateCount !== 1) {
      throw new Error("Invitation-pending session could not be activated.");
    }

    const revokedTokenCount = await this.transaction.$executeRawUnsafe(
      REVOKE_INVITATION_SESSION_TOKENS_SQL,
      this.tenantId,
      input.sessionId,
      input.now,
    );
    if (revokedTokenCount < 1) {
      throw new Error("Invitation-pending session token is unavailable.");
    }

    const insertedTokenCount = await this.transaction.$executeRawUnsafe(
      INSERT_ROTATED_SESSION_TOKEN_SQL,
      this.idFactory(),
      input.sessionId,
      this.tenantId,
      parsedToken.selector,
      deriveSessionSecretDigest({
        digestKey: this.options.digestKey,
        secret: parsedToken.secret,
      }),
      input.now,
      lockedSession.absoluteExpiresAt,
    );
    if (insertedTokenCount !== 1) {
      throw new Error("Rotated invitation session token could not be persisted.");
    }

    return Object.freeze({
      sessionId: input.sessionId,
      rotatedToken,
    });
  }
}
