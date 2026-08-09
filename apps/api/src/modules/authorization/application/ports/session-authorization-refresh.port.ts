export interface RefreshSessionAuthorizationInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly userAuthorizationVersion: number;
  readonly membershipAuthorizationVersion?: number;
  readonly presentedToken: string;
  readonly requestId: string;
  readonly reason: "authorization_version_changed";
}

export interface SessionAuthorizationRotationResult {
  readonly successorToken: string;
}

export interface RevokeStaleAuthorizationSessionInput {
  readonly sessionId: string;
  readonly userId: string;
  readonly requestId: string;
  readonly reason: "authorization_subject_inactive";
}

export interface SessionAuthorizationRefreshPort {
  refreshAndRotate(
    input: RefreshSessionAuthorizationInput,
  ): Promise<SessionAuthorizationRotationResult>;
  revoke(input: RevokeStaleAuthorizationSessionInput): Promise<void>;
}
