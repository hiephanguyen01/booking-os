export interface ElevateInvitationSessionInput {
  readonly sessionId: string;
  readonly now: Date;
}

export interface SessionElevationResult {
  readonly sessionId: string;
  readonly rotatedToken: string;
}

export interface SessionElevationPort {
  elevateInvitationSession(input: ElevateInvitationSessionInput): Promise<SessionElevationResult>;
}
