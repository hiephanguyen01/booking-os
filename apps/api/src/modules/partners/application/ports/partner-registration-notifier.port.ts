export interface AppendPartnerRegistrationVerificationRequestedInput {
  readonly challengeId: string;
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly serializedToken: string;
  readonly hostname: string;
  readonly occurredAt: Date;
}

export interface PartnerRegistrationNotifierPort {
  appendVerificationRequested(
    input: AppendPartnerRegistrationVerificationRequestedInput,
  ): Promise<void>;
}
