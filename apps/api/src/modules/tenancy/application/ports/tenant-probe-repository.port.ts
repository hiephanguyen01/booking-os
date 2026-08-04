export interface TenantProbeRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly value: string;
}

export interface TenantProbeRepositoryPort {
  list(): Promise<readonly TenantProbeRecord[]>;
}
