import {
  parseSessionToken,
  verifySessionSecretDigest,
} from "@booking-os/auth";

import {
  SessionAuthorizationStaleError,
  SessionCompromisedError,
  SessionUnavailableError,
} from "../../domain/session-errors.js";
import type { SessionSecurityAuditPort } from "../ports/security-audit.port.js";
import type {
  SessionRepositoryPort,
  SessionScope,
  StoredSession,
  StoredSessionWithToken,
} from "../ports/session-repository.port.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const ROTATION_AGE_MS = 15 * 60 * 1000;

export interface ValidateSessionInput {
  readonly token: string;
  readonly hostname: string;
  readonly scope: SessionScope;
  readonly authorizationVersion: number;
  readonly requestId: string;
}

export interface ValidateSessionOptions {
  readonly now?: () => Date;
  readonly digestKey: Uint8Array;
}

function sameScope(left: SessionScope, right: SessionScope): boolean {
  return (
    left.type === right.type &&
    (left.type === "platform" ||
      (right.type === "tenant" && left.tenantId === right.tenantId))
  );
}

function isAvailable(stored: StoredSessionWithToken, input: ValidateSessionInput, now: Date): boolean {
  return (
    stored.session.hostname === input.hostname &&
    sameScope(stored.session.scope, input.scope) &&
    (stored.session.state === "active" || stored.session.state === "invitation_pending") &&
    stored.session.revokedAt === null &&
    stored.session.compromisedAt === null &&
    stored.token.revokedAt === null &&
    stored.session.idleExpiresAt.getTime() > now.getTime() &&
    stored.session.absoluteExpiresAt.getTime() > now.getTime() &&
    stored.token.expiresAt.getTime() > now.getTime()
  );
}

export class ValidateSessionUseCase {
  private readonly now: () => Date;

  constructor(
    private readonly sessions: SessionRepositoryPort,
    private readonly audit: SessionSecurityAuditPort,
    private readonly options: ValidateSessionOptions,
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async execute(input: ValidateSessionInput): Promise<{
    readonly session: StoredSession;
    readonly tokenDisposition: "active" | "overlap";
    readonly rotationRequired: boolean;
  }> {
    const parsed = parseSessionToken(input.token);
    if (!parsed) throw new SessionUnavailableError();

    const stored = await this.sessions.findBySelector({
      selector: parsed.selector,
      hostname: input.hostname,
      scope: input.scope,
    });
    const now = this.now();
    if (!stored || !isAvailable(stored, input, now)) throw new SessionUnavailableError();
    if (
      !verifySessionSecretDigest({
        digestKey: this.options.digestKey,
        secret: parsed.secret,
        expectedDigest: stored.token.tokenHash,
      })
    ) {
      throw new SessionUnavailableError();
    }
    if (stored.session.authorizationVersion !== input.authorizationVersion) {
      throw new SessionAuthorizationStaleError();
    }

    const replaced = stored.token.replacedAt !== null;
    const overlap = replaced && (stored.token.overlapUntil?.getTime() ?? 0) >= now.getTime();
    if (replaced && !overlap) {
      await this.sessions.markCompromised({
        sessionId: stored.session.id,
        tokenId: stored.token.id,
        compromisedAt: now,
        reason: "token_reuse",
      });
      await this.audit.record({
        eventType: "session.compromised",
        actorUserId: stored.session.userId,
        subjectUserId: stored.session.userId,
        sessionId: stored.session.id,
        requestId: input.requestId,
        metadata: { reason: "token_reuse", hostname: input.hostname },
        occurredAt: now,
      });
      throw new SessionCompromisedError();
    }

    const nextIdleExpiry = new Date(
      Math.min(now.getTime() + 7 * DAY_MS, stored.session.absoluteExpiresAt.getTime()),
    );
    await this.sessions.touchIfDue({
      sessionId: stored.session.id,
      expectedVersion: stored.session.version,
      lastSeenAt: now,
      idleExpiresAt: nextIdleExpiry,
    });

    return {
      session: stored.session,
      tokenDisposition: overlap ? "overlap" : "active",
      rotationRequired: now.getTime() - stored.token.issuedAt.getTime() >= ROTATION_AGE_MS,
    };
  }
}
