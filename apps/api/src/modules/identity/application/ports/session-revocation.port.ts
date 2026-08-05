export interface SessionRevocationPort {
  revokeAllForUser(userId: string, revokedAt: Date): Promise<void>;
}
