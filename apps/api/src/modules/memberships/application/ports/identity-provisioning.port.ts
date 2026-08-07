export interface ProvisionedIdentity {
  readonly userId: string;
  readonly status: "pending_activation" | "active";
  readonly created: boolean;
}

export interface ProvisionIdentityInput {
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly now: Date;
}

export interface IssueTenantActivationInput {
  readonly userId: string;
  readonly tenantId: string;
  readonly invitationId: string;
  readonly hostname: string;
  readonly selector: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly now: Date;
}

export interface IdentityProvisioningPort {
  findOrCreatePendingIdentity(input: ProvisionIdentityInput): Promise<ProvisionedIdentity>;
  issueTenantActivation(input: IssueTenantActivationInput): Promise<void>;
}
