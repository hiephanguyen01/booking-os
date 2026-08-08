import type { SessionScope, SessionState } from "./session-repository.port.js";

export interface LoginSessionSubject {
  readonly authorizationVersion: number;
  readonly state: Extract<SessionState, "active" | "invitation_pending">;
}

export interface ResolveLoginSubjectInput {
  readonly userId: string;
  readonly hostname: string;
  readonly scope: SessionScope;
}

export interface SessionSubjectPort {
  resolveForLogin(input: ResolveLoginSubjectInput): Promise<LoginSessionSubject | null>;
  currentAuthorizationVersion(userId: string): Promise<number | null>;
}
