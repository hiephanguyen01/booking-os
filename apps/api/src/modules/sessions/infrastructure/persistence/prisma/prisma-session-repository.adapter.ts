import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  CreateSessionRecord,
  FindSessionInput,
  MarkSessionCompromisedInput,
  RevokeOtherSessionsInput,
  RevokeSessionInput,
  RotateSessionInput,
  RotationResult,
  SessionRepositoryPort,
  SessionScope,
  SessionState,
  StoredSession,
  StoredSessionToken,
  StoredSessionWithToken,
  TouchSessionInput,
} from "../../../application/ports/session-repository.port.js";

const TOUCH_COALESCE_MS = 5 * 60 * 1000;

const LOCK_SESSION_TOKEN_SQL = `
  SELECT
    token."id",
    token."session_id" AS "sessionId",
    session."scope_type"::text AS "scopeType",
    session."tenant_id" AS "tenantId",
    token."replaced_at" AS "replacedAt",
    token."overlap_until" AS "overlapUntil",
    token."successor_token_id" AS "successorTokenId",
    token."reuse_detected_at" AS "reuseDetectedAt",
    token."revoked_at" AS "revokedAt"
  FROM "auth_session_tokens" AS token
  INNER JOIN "auth_sessions" AS session ON session."id" = token."session_id"
  WHERE token."id" = $1 AND token."session_id" = $2
  FOR UPDATE OF token
`;

interface SessionRow {
  readonly id: string;
  readonly userId: string;
  readonly scopeType: string;
  readonly tenantId: string | null;
  readonly hostname: string;
  readonly state: string;
  readonly authorizationVersion: number;
  readonly membershipAuthorizationVersion: number | null;
  readonly version: number;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly lastSeenAt: Date;
  readonly revokedAt: Date | null;
  readonly revocationReason: string | null;
  readonly compromisedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

interface TokenRow {
  readonly id: string;
  readonly sessionId: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
  readonly replacedAt: Date | null;
  readonly overlapUntil: Date | null;
  readonly successorTokenId: string | null;
  readonly reuseDetectedAt: Date | null;
  readonly revokedAt: Date | null;
}

interface TokenWithSessionRow extends TokenRow {
  readonly session: SessionRow;
}

interface LockedTokenRow {
  readonly id: string;
  readonly sessionId: string;
  readonly scopeType: string;
  readonly tenantId: string | null;
  readonly replacedAt: Date | null;
  readonly overlapUntil: Date | null;
  readonly successorTokenId: string | null;
  readonly reuseDetectedAt: Date | null;
  readonly revokedAt: Date | null;
}

function mapScope(scopeType: string, tenantId: string | null): SessionScope {
  if (scopeType === "platform" && tenantId === null) {
    return { type: "platform" };
  }
  if (scopeType === "tenant" && tenantId !== null) {
    return { type: "tenant", tenantId };
  }
  throw new Error("Stored session scope is invalid.");
}

function scopeColumns(scope: SessionScope): {
  readonly scopeType: "platform" | "tenant";
  readonly tenantId: string | null;
} {
  return scope.type === "platform"
    ? { scopeType: "platform", tenantId: null }
    : { scopeType: "tenant", tenantId: scope.tenantId };
}

function sameScope(left: SessionScope, right: SessionScope): boolean {
  return (
    left.type === right.type &&
    (left.type === "platform" || (right.type === "tenant" && left.tenantId === right.tenantId))
  );
}

function mapState(state: string): SessionState {
  switch (state) {
    case "active":
    case "compromised":
    case "revoked":
      return state;
    case "invitationPending":
    case "invitation_pending":
      return "invitation_pending";
    default:
      throw new Error("Stored session state is invalid.");
  }
}

function prismaState(
  state: SessionState,
): "active" | "invitationPending" | "compromised" | "revoked" {
  return state === "invitation_pending" ? "invitationPending" : state;
}

function mapSession(row: SessionRow): StoredSession {
  return Object.freeze({
    id: row.id,
    userId: row.userId,
    scope: mapScope(row.scopeType, row.tenantId),
    hostname: row.hostname,
    state: mapState(row.state),
    authorizationVersion: row.authorizationVersion,
    ...(typeof row.membershipAuthorizationVersion !== "number"
      ? {}
      : { membershipAuthorizationVersion: row.membershipAuthorizationVersion }),
    version: row.version,
    idleExpiresAt: row.idleExpiresAt,
    absoluteExpiresAt: row.absoluteExpiresAt,
    lastSeenAt: row.lastSeenAt,
    revokedAt: row.revokedAt,
    revocationReason: row.revocationReason,
    compromisedAt: row.compromisedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function mapToken(row: TokenRow): StoredSessionToken {
  return Object.freeze({
    id: row.id,
    sessionId: row.sessionId,
    selector: row.selector,
    tokenHash: row.tokenHash,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    replacedAt: row.replacedAt,
    overlapUntil: row.overlapUntil,
    successorTokenId: row.successorTokenId,
    reuseDetectedAt: row.reuseDetectedAt,
    revokedAt: row.revokedAt,
  });
}

@Injectable()
export class PrismaSessionRepositoryAdapter implements SessionRepositoryPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(input: CreateSessionRecord): Promise<CreateSessionRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const binding = scopeColumns(input.session.scope);
      const session = await transaction.authSession.create({
        data: {
          id: input.session.id,
          userId: input.session.userId,
          scopeType: binding.scopeType,
          tenantId: binding.tenantId,
          hostname: input.session.hostname,
          state: prismaState(input.session.state),
          authorizationVersion: input.session.authorizationVersion,
          membershipAuthorizationVersion: input.session.membershipAuthorizationVersion ?? null,
          version: input.session.version,
          idleExpiresAt: input.session.idleExpiresAt,
          absoluteExpiresAt: input.session.absoluteExpiresAt,
          lastSeenAt: input.session.lastSeenAt,
          revokedAt: input.session.revokedAt,
          revocationReason: input.session.revocationReason,
          compromisedAt: input.session.compromisedAt,
          createdAt: input.session.createdAt,
          updatedAt: input.session.updatedAt,
        },
      });
      const token = await transaction.authSessionToken.create({
        data: {
          id: input.token.id,
          sessionId: input.token.sessionId,
          scopeType: binding.scopeType,
          tenantId: binding.tenantId,
          selector: input.token.selector,
          tokenHash: input.token.tokenHash,
          issuedAt: input.token.issuedAt,
          expiresAt: input.token.expiresAt,
          replacedAt: input.token.replacedAt,
          overlapUntil: input.token.overlapUntil,
          successorTokenId: input.token.successorTokenId,
          reuseDetectedAt: input.token.reuseDetectedAt,
          revokedAt: input.token.revokedAt,
        },
      });

      return { session: mapSession(session), token: mapToken(token) };
    });
  }

  async findBySelector(input: FindSessionInput): Promise<StoredSessionWithToken | null> {
    const row = (await this.prisma.authSessionToken.findUnique({
      where: { selector: input.selector },
      include: { session: true },
    })) as TokenWithSessionRow | null;

    if (!row) {
      return null;
    }

    const session = mapSession(row.session);
    if (session.hostname !== input.hostname || !sameScope(session.scope, input.scope)) {
      return null;
    }

    return { session, token: mapToken(row) };
  }

  async rotateCompareAndSet(input: RotateSessionInput): Promise<RotationResult> {
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRawUnsafe<LockedTokenRow[]>(
        LOCK_SESSION_TOKEN_SQL,
        input.currentTokenId,
        input.sessionId,
      );
      const current = rows[0];

      if (
        !current ||
        rows.length !== 1 ||
        current.revokedAt !== null ||
        current.reuseDetectedAt !== null
      ) {
        return { status: "unavailable" };
      }

      if (current.replacedAt !== null) {
        if (
          current.successorTokenId !== null &&
          current.overlapUntil !== null &&
          current.overlapUntil.getTime() >= input.replacedAt.getTime()
        ) {
          return { status: "existing", successorTokenId: current.successorTokenId };
        }
        return { status: "reuse" };
      }

      await transaction.authSessionToken.create({
        data: {
          id: input.successor.id,
          sessionId: input.successor.sessionId,
          scopeType: current.scopeType === "platform" ? "platform" : "tenant",
          tenantId: current.tenantId,
          selector: input.successor.selector,
          tokenHash: input.successor.tokenHash,
          issuedAt: input.successor.issuedAt,
          expiresAt: input.successor.expiresAt,
          replacedAt: input.replacedAt,
          overlapUntil: input.replacedAt,
          successorTokenId: null,
          reuseDetectedAt: null,
          revokedAt: null,
        },
      });
      await transaction.authSessionToken.update({
        where: { id: input.currentTokenId },
        data: {
          replacedAt: input.replacedAt,
          overlapUntil: input.overlapUntil,
          successorTokenId: input.successor.id,
        },
      });
      await transaction.authSessionToken.update({
        where: { id: input.successor.id },
        data: { replacedAt: null, overlapUntil: null },
      });

      return { status: "rotated", successor: input.successor };
    });
  }

  async markCompromised(input: MarkSessionCompromisedInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.authSessionToken.updateMany({
        where: {
          id: input.tokenId,
          sessionId: input.sessionId,
          replacedAt: { not: null },
        },
        data: { reuseDetectedAt: input.compromisedAt },
      });
      await transaction.authSession.updateMany({
        where: { id: input.sessionId, revokedAt: null },
        data: {
          state: "compromised",
          compromisedAt: input.compromisedAt,
          revokedAt: input.compromisedAt,
          revocationReason: input.reason,
          version: { increment: 1 },
          updatedAt: input.compromisedAt,
        },
      });
      await transaction.authSessionToken.updateMany({
        where: { sessionId: input.sessionId, revokedAt: null },
        data: { revokedAt: input.compromisedAt },
      });
    });
  }

  async touchIfDue(input: TouchSessionInput): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: {
        id: input.sessionId,
        version: input.expectedVersion,
        state: { in: ["active", "invitationPending"] },
        revokedAt: null,
        lastSeenAt: {
          lte: new Date(input.lastSeenAt.getTime() - TOUCH_COALESCE_MS),
        },
      },
      data: {
        lastSeenAt: input.lastSeenAt,
        idleExpiresAt: input.idleExpiresAt,
        version: { increment: 1 },
        updatedAt: input.lastSeenAt,
      },
    });
  }

  async revokeById(input: RevokeSessionInput): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.authSession.updateMany({
        where: {
          id: input.sessionId,
          userId: input.userId,
          revokedAt: null,
        },
        data: {
          state: "revoked",
          revokedAt: input.revokedAt,
          revocationReason: input.reason,
          compromisedAt: null,
          version: { increment: 1 },
          updatedAt: input.revokedAt,
        },
      });

      if (result.count === 0) {
        return false;
      }

      await transaction.authSessionToken.updateMany({
        where: { sessionId: input.sessionId, revokedAt: null },
        data: { revokedAt: input.revokedAt },
      });
      return true;
    });
  }

  async revokeAllForUser(input: {
    readonly userId: string;
    readonly revokedAt: Date;
    readonly reason: string;
  }): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      const activeSessions = await transaction.authSession.findMany({
        where: { userId: input.userId, revokedAt: null },
        select: { id: true },
      });
      if (activeSessions.length === 0) {
        return 0;
      }

      const sessionIds = activeSessions.map((session) => session.id);
      const result = await transaction.authSession.updateMany({
        where: { id: { in: sessionIds } },
        data: {
          state: "revoked",
          revokedAt: input.revokedAt,
          revocationReason: input.reason,
          compromisedAt: null,
          version: { increment: 1 },
          updatedAt: input.revokedAt,
        },
      });
      await transaction.authSessionToken.updateMany({
        where: { sessionId: { in: sessionIds }, revokedAt: null },
        data: { revokedAt: input.revokedAt },
      });
      return result.count;
    });
  }

  async revokeOthersForUser(input: RevokeOtherSessionsInput): Promise<number> {
    return this.prisma.$transaction(async (transaction) => {
      const activeSessions = await transaction.authSession.findMany({
        where: {
          userId: input.userId,
          id: { not: input.exceptSessionId },
          revokedAt: null,
        },
        select: { id: true },
      });
      if (activeSessions.length === 0) {
        return 0;
      }

      const sessionIds = activeSessions.map((session) => session.id);
      const result = await transaction.authSession.updateMany({
        where: { id: { in: sessionIds }, revokedAt: null },
        data: {
          state: "revoked",
          revokedAt: input.revokedAt,
          revocationReason: input.reason,
          compromisedAt: null,
          version: { increment: 1 },
          updatedAt: input.revokedAt,
        },
      });
      await transaction.authSessionToken.updateMany({
        where: { sessionId: { in: sessionIds }, revokedAt: null },
        data: { revokedAt: input.revokedAt },
      });
      return result.count;
    });
  }

  async listForUser(input: { readonly userId: string }): Promise<readonly StoredSession[]> {
    const rows = await this.prisma.authSession.findMany({
      where: { userId: input.userId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(mapSession);
  }
}
