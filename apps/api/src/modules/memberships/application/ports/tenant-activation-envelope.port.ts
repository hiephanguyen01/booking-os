export interface TenantActivationEnvelopeValue {
  readonly version: 1;
  readonly keyId: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}

export interface SealTenantActivationInput {
  readonly eventId: string;
  readonly tenantId: string;
  readonly invitationId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly recipient: string;
  readonly serializedToken: string;
}

export interface TenantActivationEnvelopePort {
  seal(input: SealTenantActivationInput): TenantActivationEnvelopeValue;
}
