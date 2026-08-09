export type ProvisioningTenantStatus = "provisioning";

export type ProvisionPlatformTenantInput = Readonly<{
  actorUserId: string;
  idempotencyKey: string;
  requestHash: string;
  slug: string;
  tenantName: string;
  ownerEmail: string;
  normalizedOwnerEmail: string;
  tenantHostname: string;
  requestId: string;
  now: Date;
}>;

export type ProvisionPlatformTenantResult = Readonly<{
  tenantId: string;
  slug: string;
  status: ProvisioningTenantStatus;
  ownerMembershipId: string;
  ownerInvitationId: string;
  replayed: boolean;
}>;

export type GetPlatformTenantProvisioningInput = Readonly<{
  actorUserId: string;
  tenantId: string;
}>;

export type GetPlatformTenantProvisioningResult = Readonly<
  Omit<ProvisionPlatformTenantResult, "replayed"> & { tenantName: string }
>;

export type ResendOwnerInvitationInput = Readonly<{
  actorUserId: string;
  tenantId: string;
  requestId: string;
  now: Date;
}>;

export type ResendOwnerInvitationResult = Readonly<{
  accepted: true;
}>;

export interface PlatformTenantProvisioningWorkflowPort {
  provision(input: ProvisionPlatformTenantInput): Promise<ProvisionPlatformTenantResult>;
  resendOwnerInvitation(input: ResendOwnerInvitationInput): Promise<ResendOwnerInvitationResult>;
}

export interface PlatformTenantProvisioningQueryPort {
  getProvisioning(
    input: GetPlatformTenantProvisioningInput,
  ): Promise<GetPlatformTenantProvisioningResult>;
}
