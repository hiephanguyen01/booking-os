import { createSessionToken, deriveSessionSecretDigest, parseSessionToken } from "@booking-os/auth";

import type { SessionSecurityAuditPort } from "../ports/security-audit.port.js";
import type {
  SessionRepositoryPort,
  SessionScope,
  SessionState,
  StoredSession,
} from "../ports/session-repository.port.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CreateSessionInput {
  readonly userId: string;
  readonly scope: SessionScope;
  readonly hostname: string;
  readonly state: Extract<SessionState, "active" | "invitation_pending">;
  readonly authorizationVersion: number;
  readonly requestId: string;
}

export interface CreateSessionOptions {
  readonly now?: () => Date;
  readonly digestKey: Uint8Array;
  readonly idFactory?: () => string;
  readonly tokenFactory?: () => string;
}

export class CreateSessionUseCase {
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly tokenFactory: () => string;

  constructor(
    private readonly sessions: SessionRepositoryPort,
    private readonly audit: SessionSecurityAuditPort,
    private readonly options: CreateSessionOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.tokenFactory = options.tokenFactory ?? (() => createSessionToken());
  }

  async execute(
    input: CreateSessionInput,
  ): Promise<{ readonly token: string; readonly session: StoredSession }> {
    const now = this.now();
    const token = this.tokenFactory();
    const parsed = parseSessionToken(token);
    if (!parsed) throw new TypeError("Token factory returned an invalid session token.");

    const sessionId = this.idFactory();
    const record = {
      session: {
        id: sessionId,
        userId: input.userId,
        scope: input.scope,
        hostname: input.hostname,
        state: input.state,
        authorizationVersion: input.authorizationVersion,
        version: 1,
        idleExpiresAt: new Date(now.getTime() + 7 * DAY_MS),
        absoluteExpiresAt: new Date(now.getTime() + 30 * DAY_MS),
        lastSeenAt: now,
        revokedAt: null,
        revocationReason: null,
        compromisedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      token: {
        id: this.idFactory(),
        sessionId,
        selector: parsed.selector,
        tokenHash: deriveSessionSecretDigest({
          digestKey: this.options.digestKey,
          secret: parsed.secret,
        }),
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 30 * DAY_MS),
        replacedAt: null,
        overlapUntil: null,
        successorTokenId: null,
        reuseDetectedAt: null,
        revokedAt: null,
      },
    } as const;

    const created = await this.sessions.create(record);
    await this.audit.record({
      eventType: "session.created",
      actorUserId: input.userId,
      subjectUserId: input.userId,
      sessionId,
      requestId: input.requestId,
      metadata: {
        hostname: input.hostname,
        scopeType: input.scope.type,
        ...(input.scope.type === "tenant" ? { tenantId: input.scope.tenantId } : {}),
        state: input.state,
      },
      occurredAt: now,
    });

    return { token, session: created.session };
  }
}
