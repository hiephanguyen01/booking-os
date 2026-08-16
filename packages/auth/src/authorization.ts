import { PERMISSION_KEYS, type PermissionKey } from "./permissions.js";
import { SYSTEM_ROLES, type SystemRole } from "./roles.js";

export const ROLE_PERMISSIONS: Readonly<Record<SystemRole, readonly PermissionKey[]>> = {
  [SYSTEM_ROLES.platformAdmin]: [
    PERMISSION_KEYS.platformSecurityAuditRead,
    PERMISSION_KEYS.platformSecuritySessionRevoke,
    PERMISSION_KEYS.platformTenantsProvision,
    PERMISSION_KEYS.platformUsersProvision,
  ],
  [SYSTEM_ROLES.tenantOwner]: [
    PERMISSION_KEYS.tenantMembershipRead,
    PERMISSION_KEYS.tenantMembershipAdminInvite,
    PERMISSION_KEYS.tenantMembershipAdminSuspend,
    PERMISSION_KEYS.tenantMembershipAdminRevoke,
    PERMISSION_KEYS.tenantMembershipOwnerPromote,
    PERMISSION_KEYS.tenantMembershipOwnerDemote,
    PERMISSION_KEYS.tenantSecuritySessionRead,
    PERMISSION_KEYS.tenantSecuritySessionRevoke,
    PERMISSION_KEYS.tenantRbacPermissionRead,
    PERMISSION_KEYS.tenantRbacRoleRead,
    PERMISSION_KEYS.tenantRbacRoleCreate,
    PERMISSION_KEYS.tenantRbacRoleUpdate,
    PERMISSION_KEYS.tenantRbacRoleArchive,
    PERMISSION_KEYS.tenantRbacRolePermissionGrant,
    PERMISSION_KEYS.tenantRbacRolePermissionRevoke,
    PERMISSION_KEYS.tenantRbacAssignmentRead,
    PERMISSION_KEYS.tenantRbacAssignmentGrant,
    PERMISSION_KEYS.tenantRbacAssignmentRevoke,
  ],
  [SYSTEM_ROLES.tenantAdmin]: [
    PERMISSION_KEYS.tenantMembershipRead,
    PERMISSION_KEYS.tenantMembershipAdminInvite,
    PERMISSION_KEYS.tenantMembershipAdminSuspend,
    PERMISSION_KEYS.tenantMembershipAdminRevoke,
    PERMISSION_KEYS.tenantSecuritySessionRead,
    PERMISSION_KEYS.tenantSecuritySessionRevoke,
    PERMISSION_KEYS.tenantRbacPermissionRead,
    PERMISSION_KEYS.tenantRbacRoleRead,
    PERMISSION_KEYS.tenantRbacAssignmentRead,
  ],
};

export function getPermissions(role: SystemRole): PermissionKey[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(
  role: SystemRole | null | undefined,
  permission: PermissionKey,
): boolean {
  return role ? ROLE_PERMISSIONS[role].includes(permission) : false;
}
