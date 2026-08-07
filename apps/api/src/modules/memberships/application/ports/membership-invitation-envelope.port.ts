export interface MembershipInvitationEnvelopeValue {
  readonly version: 1;
  readonly keyId: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}

export interface SealMembershipInvitationInput {
  readonly eventId: string;
  readonly tenantId: string;
  readonly invitationId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly normalizedEmail: string;
  readonly intendedRoleKey: "tenant_owner";
  readonly serializedToken: string;
}

export interface MembershipInvitationEnvelopePort {
  seal(input: SealMembershipInvitationInput): MembershipInvitationEnvelopeValue;
}
