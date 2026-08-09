export type SessionScope =
  | { readonly type: "platform" }
  | { readonly type: "tenant"; readonly tenantId: string };

export type SessionState = "active" | "invitation_pending" | "compromised" | "revoked";

export interface StoredSession {
  readonly id: string;
  readonly userId: string;
  readonly scope: SessionScope;
  readonly hostname: string;
  readonly state: SessionState;
  readonly authorizationVersion: number;
  readonly membershipAuthorizationVersion?: number;
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
