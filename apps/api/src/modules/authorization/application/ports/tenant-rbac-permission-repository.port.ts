import type { PermissionKey } from "@booking-os/auth";

export interface TenantRbacPermissionRecord {
  readonly id: string;
  readonly key: PermissionKey;
}

export interface TenantRbacPermissionRepositoryPort {
  findTenantPermissionsByKeys(
    keys: readonly PermissionKey[],
  ): Promise<readonly TenantRbacPermissionRecord[]>;
}
