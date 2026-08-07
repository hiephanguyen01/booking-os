export type ProvisioningTenantStatus = "provisioning" | "active" | "suspended";

export interface ProvisioningTenant {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: ProvisioningTenantStatus;
}

export interface NewlyProvisionedTenant extends ProvisioningTenant {
  readonly status: "provisioning";
}

export interface CreateProvisioningTenantInput {
  readonly slug: string;
  readonly name: string;
  readonly now: Date;
}

export interface TenantProvisioningRepositoryPort {
  findCurrent(): Promise<ProvisioningTenant | null>;
  lockCurrent(): Promise<ProvisioningTenant | null>;
  createProvisioning(input: CreateProvisioningTenantInput): Promise<NewlyProvisionedTenant>;
  addPrimaryDomain(hostname: string, now: Date): Promise<void>;
  activate(now: Date): Promise<void>;
  suspend(now: Date): Promise<void>;
}
