import type {
  SessionScope,
  StoredSession,
} from "../../domain/auth-session.js";
import type { StoredSessionToken } from "../../domain/auth-session-token.js";

export type {
  SessionScope,
  SessionState,
  StoredSession,
} from "../../domain/auth-session.js";
export type { StoredSessionToken } from "../../domain/auth-session-token.js";

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
