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

export interface StoredSessionToken {
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

export interface StoredSessionWithToken {
  readonly session: StoredSession;
  readonly token: StoredSessionToken;
}

export interface CreateSessionRecord extends StoredSessionWithToken {}

export interface FindSessionInput {
  readonly selector: string;
  readonly hostname: string;
  readonly scope: SessionScope;
}

export interface TouchSessionInput {
  readonly sessionId: string;
  readonly expectedVersion: number;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
}

export interface MarkSessionCompromisedInput {
  readonly sessionId: string;
  readonly tokenId: string;
  readonly compromisedAt: Date;
  readonly reason: "token_reuse";
}

export interface RotateSessionInput {
  readonly sessionId: string;
  readonly currentTokenId: string;
  readonly replacedAt: Date;
  readonly overlapUntil: Date;
  readonly successor: StoredSessionToken;
}

export type RotationResult =
  | { readonly status: "rotated"; readonly successor: StoredSessionToken }
  | { readonly status: "existing"; readonly successorTokenId: string }
  | { readonly status: "reuse" }
  | { readonly status: "unavailable" };

export interface RevokeSessionInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly revokedAt: Date;
  readonly reason: string;
}

export interface SessionRepositoryPort {
  create(input: CreateSessionRecord): Promise<CreateSessionRecord>;
  findBySelector(input: FindSessionInput): Promise<StoredSessionWithToken | null>;
  rotateCompareAndSet(input: RotateSessionInput): Promise<RotationResult>;
  markCompromised(input: MarkSessionCompromisedInput): Promise<void>;
  touchIfDue(input: TouchSessionInput): Promise<void>;
  revokeById(input: RevokeSessionInput): Promise<boolean>;
  revokeAllForUser(input: {
    readonly userId: string;
    readonly revokedAt: Date;
    readonly reason: string;
  }): Promise<number>;
  listForUser(input: { readonly userId: string }): Promise<readonly StoredSession[]>;
}
