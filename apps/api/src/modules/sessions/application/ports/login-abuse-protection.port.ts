export interface LoginAttemptKey {
  readonly accountDigest: string;
  readonly sourceDigest: string;
  readonly combinedDigest: string;
  readonly sourceSummary: string;
}

export interface LoginAbuseProtectionPort {
  beforeAttempt(input: LoginAttemptKey): Promise<{ readonly delayMs: number }>;
  recordFailure(input: LoginAttemptKey): Promise<void>;
  recordSuccess(input: LoginAttemptKey): Promise<void>;
}
