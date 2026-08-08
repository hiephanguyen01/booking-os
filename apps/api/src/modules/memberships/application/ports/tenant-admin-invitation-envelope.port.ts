export interface TenantAdminInvitationEnvelopeValue {
  readonly version: 1;
  readonly keyId: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}

export interface SealTenantAdminInvitationInput {
  readonly eventId: string;
  readonly tenantId: string;
  readonly invitationId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly normalizedEmail: string;
  readonly serializedToken: string;
}

export interface TenantAdminInvitationEnvelopePort {
  seal(input: SealTenantAdminInvitationInput): TenantAdminInvitationEnvelopeValue;
}
