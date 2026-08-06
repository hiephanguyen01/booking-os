import type {
  SessionRepositoryPort,
  SessionScope,
  SessionState,
} from "../ports/session-repository.port.js";

export interface ListSessionsInput {
  readonly userId: string;
  readonly currentSessionId: string;
}

export interface SessionSummary {
  readonly id: string;
  readonly scope: SessionScope;
  readonly hostname: string;
  readonly state: SessionState;
  readonly current: boolean;
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export class ListSessionsUseCase {
  constructor(private readonly sessions: SessionRepositoryPort) {}

  async execute(input: ListSessionsInput): Promise<readonly SessionSummary[]> {
    const sessions = await this.sessions.listForUser({ userId: input.userId });
    return sessions.map((session) => ({
      id: session.id,
      scope: session.scope,
      hostname: session.hostname,
      state: session.state,
      current: session.id === input.currentSessionId,
      createdAt: session.createdAt,
      lastSeenAt: session.lastSeenAt,
      idleExpiresAt: session.idleExpiresAt,
      absoluteExpiresAt: session.absoluteExpiresAt,
    }));
  }
}
