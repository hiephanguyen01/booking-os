import type { SessionRepositoryPort } from "../ports/session-repository.port.js";

export interface RevokeSessionInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly reason: string;
  readonly requestId: string;
}

export class RevokeSessionUseCase {
  private readonly now: () => Date;

  constructor(
    private readonly sessions: SessionRepositoryPort,
    options: { readonly now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async execute(input: RevokeSessionInput): Promise<{ readonly revoked: boolean }> {
    const now = this.now();
    const revoked = await this.sessions.revokeById({
      sessionId: input.sessionId,
      userId: input.userId,
      revokedAt: now,
      reason: input.reason,
      audit: {
        eventType: "session.revoked",
        actorUserId: input.userId,
        subjectUserId: input.userId,
        sessionId: input.sessionId,
        requestId: input.requestId,
        metadata: { reason: input.reason },
        occurredAt: now,
      },
    });

    return { revoked };
  }
}
