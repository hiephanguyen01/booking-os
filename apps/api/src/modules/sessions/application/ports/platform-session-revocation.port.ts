export interface PlatformSessionRevocationInput {
  readonly actorUserId: string;
  readonly targetUserId: string;
  readonly revokedAt: Date;
  readonly revocationReason: string;
  readonly requestId: string;
  readonly hostname: string;
}

export interface PlatformSessionRevocationPort {
  revokeAllForUserAndAudit(input: PlatformSessionRevocationInput): Promise<number>;
}
