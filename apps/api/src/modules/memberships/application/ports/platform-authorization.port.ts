import type { AuthorizationPermissionKey, AuthorizationRoleKey } from "@booking-os/contracts";

export interface PlatformAuthorizationSnapshot {
  readonly userAuthorizationVersion: number;
  readonly roleKeys: readonly AuthorizationRoleKey[];
  readonly permissionKeys: readonly AuthorizationPermissionKey[];
}

export interface PlatformAuthorizationPort {
  loadActivePlatformAuthorization(userId: string): Promise<PlatformAuthorizationSnapshot | null>;
}
