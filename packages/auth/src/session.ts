export type SessionScope =
  | { readonly type: "platform" }
  | { readonly type: "tenant"; readonly tenantId: string };

export type SessionState = "active" | "invitation_pending" | "compromised" | "revoked";
export type PublicSessionState = Extract<SessionState, "active" | "invitation_pending">;

export interface SessionSubject {
  readonly userId: string;
  readonly scope: SessionScope;
  readonly hostname: string;
  readonly authorizationVersion: number;
}

export interface PublicSession extends SessionSubject {
  readonly id: string;
  readonly state: PublicSessionState;
  readonly idleExpiresAt: string;
  readonly absoluteExpiresAt: string;
}
