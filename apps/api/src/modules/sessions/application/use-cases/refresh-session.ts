import {
  createSessionToken,
  deriveSessionSecretDigest,
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
} from "../ports/session-repository.port.js";

const OVERLAP_MS = 30 * 1000;

export interface RefreshSessionInput {
  readonly token: string;
  readonly hostname: string;
  readonly scope: SessionScope;
  readonly authorizationVersion: number;
  readonly requestId: string;
}

export interface RefreshSessionOptions {
  readonly now?: () => Date;
  readonly digestKey: Uint8Array;
  readonly idFactory?: () => string;
  readonly tokenFactory?: () => string;
}

function sameScope(left: SessionScope, right: SessionScope): boolean {
  return (
    left.type === right.type &&
    (left.type === "platform" ||
      (right.type === "tenant" && left.tenantId === right.tenantId))
  );
}

export class RefreshSessionUseCase {
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly tokenFactory: () => string;

  constructor(
    private readonly sessions: SessionRepositoryPort,
    private readonly audit: SessionSecurityAuditPort,
    private readonly options: RefreshSessionOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.tokenFactory = options.tokenFactory ?? (() => createSessionToken());
  }

  async execute(input: RefreshSessionInput): Promise<{
    readonly status: "rotated" | "overlap";
    readonly token: string | null;
    readonly session: StoredSession;
  }> {
    const parsed = parseSessionToken(input.token);
    if (!parsed) throw new SessionUnavailableError();
    const stored = await this.sessions.findBySelector({
      selector: parsed.selector,
      hostname: input.hostname,
      scope: input.scope,
    });
    const now = this.now();
    if (
      !stored ||
      stored.session.hostname !== input.hostname ||
      !sameScope(stored.session.scope, input.scope) ||
      stored.session.state !== "active" ||
      stored.session.revokedAt !== null ||
      stored.session.compromisedAt !== null ||
      stored.session.idleExpiresAt.getTime() <= now.getTime() ||
      stored.session.absoluteExpiresAt.getTime() <= now.getTime() ||
      stored.token.expiresAt.getTime() <= now.getTime() ||
      stored.token.revokedAt !== null ||
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

    const rawSuccessor = this.tokenFactory();
    const parsedSuccessor = parseSessionToken(rawSuccessor);
    if (!parsedSuccessor) throw new TypeError("Token factory returned an invalid session token.");
    const result = await this.sessions.rotateCompareAndSet({
      sessionId: stored.session.id,
      currentTokenId: stored.token.id,
      replacedAt: now,
      overlapUntil: new Date(now.getTime() + OVERLAP_MS),
      successor: {
        id: this.idFactory(),
        sessionId: stored.session.id,
        selector: parsedSuccessor.selector,
        tokenHash: deriveSessionSecretDigest({
          digestKey: this.options.digestKey,
          secret: parsedSuccessor.secret,
        }),
        issuedAt: now,
        expiresAt: stored.session.absoluteExpiresAt,
        replacedAt: null,
        overlapUntil: null,
        successorTokenId: null,
        reuseDetectedAt: null,
        revokedAt: null,
      },
    });

    if (result.status === "rotated") {
      return { status: "rotated", token: rawSuccessor, session: stored.session };
    }
    if (result.status === "existing") {
      return { status: "overlap", token: null, session: stored.session };
    }
    if (result.status === "reuse") {
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
    throw new SessionUnavailableError();
  }
}
