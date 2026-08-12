import type { SessionRepositoryPort } from "../ports/session-repository.port.js";

const REVOCATION_REASON = "other_devices_revoked";

export interface RevokeOtherSessionsInput {
  readonly userId: string;
  readonly currentSessionId: string;
  readonly requestId: string;
}

export class RevokeOtherSessionsUseCase {
  private readonly now: () => Date;

  constructor(
    private readonly sessions: SessionRepositoryPort,
    options: { readonly now?: () => Date } = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async execute(input: RevokeOtherSessionsInput): Promise<{ readonly revokedCount: number }> {
    const now = this.now();
    const revokedCount = await this.sessions.revokeOthersForUser({
      userId: input.userId,
      exceptSessionId: input.currentSessionId,
      revokedAt: now,
      reason: REVOCATION_REASON,
      audit: {
        eventType: "session.revoked",
        actorUserId: input.userId,
        subjectUserId: input.userId,
        sessionId: input.currentSessionId,
        requestId: input.requestId,
        metadata: { reason: REVOCATION_REASON },
        occurredAt: now,
      },
    });

    return { revokedCount };
  }
}
