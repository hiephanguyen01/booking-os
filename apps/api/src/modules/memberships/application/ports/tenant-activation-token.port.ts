export interface IssueTenantActivationTokenInput {
  readonly tenantId: string;
  readonly hostname: string;
}

export interface IssuedTenantActivationToken {
  readonly selector: string;
  readonly serialized: string;
  readonly tokenHash: string;
}

export interface TenantActivationTokenPort {
  issue(input: IssueTenantActivationTokenInput): IssuedTenantActivationToken;
}
