export interface IssuedOneTimeToken {
  readonly selector: string;
  readonly serialized: string;
  readonly tokenHash: string;
}

export interface VerifiedOneTimeToken {
  readonly selector: string;
}

export interface OneTimeTokenPort {
  issue(purpose: string): IssuedOneTimeToken;
  verify(
    serialized: string,
    purpose: string,
    expectedTokenHash: string,
  ): VerifiedOneTimeToken | null;
}
