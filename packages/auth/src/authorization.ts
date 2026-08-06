import { PERMISSIONS, type Permission } from "./permissions.js";
import { ROLES, type Role } from "./roles.js";

export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  [ROLES.platformAdmin]: [
    PERMISSIONS.platformManage,
    PERMISSIONS.tenantManage,
    PERMISSIONS.listingManage,
    PERMISSIONS.bookingView,
    PERMISSIONS.affiliateView,
  ],
  [ROLES.tenantAdmin]: [
    PERMISSIONS.tenantManage,
    PERMISSIONS.listingManage,
    PERMISSIONS.bookingView,
  ],
  [ROLES.partner]: [PERMISSIONS.listingManage, PERMISSIONS.bookingView],
  [ROLES.affiliate]: [PERMISSIONS.affiliateView],
};

export function getPermissions(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  return role ? ROLE_PERMISSIONS[role].includes(permission) : false;
}
