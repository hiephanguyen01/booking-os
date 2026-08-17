export interface InitialOwnerOnboardingEnvelopeValue {
  readonly version: 1;
  readonly keyId: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}

export interface SealInitialOwnerOnboardingInput {
  readonly eventId: string;
  readonly tenantId: string;
  readonly invitationId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly recipient: string;
  readonly activationToken: string;
  readonly invitationToken: string;
}

export interface InitialOwnerOnboardingEnvelopePort {
  seal(input: SealInitialOwnerOnboardingInput): InitialOwnerOnboardingEnvelopeValue;
}
