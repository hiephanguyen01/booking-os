export const SYSTEM_ROLES = {
  platformAdmin: "platform_admin",
  tenantOwner: "tenant_owner",
  tenantAdmin: "tenant_admin",
} as const;

export type SystemRole = (typeof SYSTEM_ROLES)[keyof typeof SYSTEM_ROLES];

export const ROLES = SYSTEM_ROLES;
export type Role = SystemRole;
