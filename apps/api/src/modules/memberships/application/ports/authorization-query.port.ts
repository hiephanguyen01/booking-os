import type { PermissionKey, SystemRole } from "@booking-os/auth";

export interface TenantAuthorizationSnapshot {
  readonly membershipId: string;
  readonly membershipStatus: "active";
  readonly membershipAuthorizationVersion: number;
  readonly roleKeys: readonly SystemRole[];
  readonly permissionKeys: readonly PermissionKey[];
}

export interface AuthorizationQueryPort {
  loadActiveTenantAuthorization(userId: string): Promise<TenantAuthorizationSnapshot | null>;
}
