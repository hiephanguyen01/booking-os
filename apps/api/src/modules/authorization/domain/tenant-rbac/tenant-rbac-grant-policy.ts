import {
  getPermissionCatalogEntry,
  SYSTEM_ROLES,
  type PermissionKey,
  type SystemRole,
} from "@booking-os/auth";

export interface TenantRbacGrantPolicyInput {
  readonly actorSystemRoles: readonly SystemRole[];
  readonly actorPermissionKeys: readonly PermissionKey[];
}

export function canMutateTenantRbac(input: TenantRbacGrantPolicyInput): boolean {
  return input.actorSystemRoles.includes(SYSTEM_ROLES.tenantOwner);
}

export function canAddTenantRolePermission(
  input: TenantRbacGrantPolicyInput,
  permission: PermissionKey,
): boolean {
  const entry = getPermissionCatalogEntry(permission);
  return (
    canMutateTenantRbac(input) &&
    entry?.scopeLevel === "tenant" &&
    entry.delegable &&
    input.actorPermissionKeys.includes(permission)
  );
}
