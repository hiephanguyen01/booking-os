export interface IssuedOneTimeToken {
  readonly selector: string;
  readonly serialized: string;
  readonly tokenHash: string;
}

export interface DerivedOneTimeToken {
  readonly selector: string;
  readonly tokenHash: string;
}

export interface VerifiedOneTimeToken {
  readonly selector: string;
}

export interface OneTimeTokenPort {
  issue(purpose: string): IssuedOneTimeToken;
  derive(serialized: string, purpose: string): DerivedOneTimeToken | null;
  verify(
    serialized: string,
    purpose: string,
    expectedTokenHash: string,
  ): VerifiedOneTimeToken | null;
}
