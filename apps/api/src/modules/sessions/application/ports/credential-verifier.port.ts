export type CredentialUserStatus = "pending_activation" | "active" | "suspended" | "disabled";

export interface VerifiedCredential {
  readonly userId: string;
  readonly status: CredentialUserStatus;
  readonly passwordNeedsRehash: boolean;
}

export interface VerifyCredentialInput {
  readonly normalizedEmail: string;
  readonly password: string;
}

export interface RehashPasswordInput {
  readonly userId: string;
  readonly password: string;
}

export interface CredentialVerifierPort {
  verify(input: VerifyCredentialInput): Promise<VerifiedCredential | null>;
  rehashPassword(input: RehashPasswordInput): Promise<void>;
}
