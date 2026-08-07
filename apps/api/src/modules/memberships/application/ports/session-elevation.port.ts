export interface ElevateInvitationSessionInput {
  readonly sessionId: string;
  readonly membershipAuthorizationVersion: number;
  readonly now: Date;
}

export interface SessionElevationResult {
  readonly sessionId: string;
  readonly rotatedToken: string;
}

export interface SessionElevationPort {
  elevateInvitationSession(
    input: ElevateInvitationSessionInput,
  ): Promise<SessionElevationResult>;
}
