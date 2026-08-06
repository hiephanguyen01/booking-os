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
