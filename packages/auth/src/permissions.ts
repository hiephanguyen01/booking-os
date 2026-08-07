export const PERMISSION_KEYS = {
  platformSecurityAuditRead: "platform.security.audit.read",
  platformTenantsProvision: "platform.tenants.provision",
  platformUsersProvision: "platform.users.provision",
  tenantMembershipRead: "tenant.membership.read",
  tenantMembershipAdminInvite: "tenant.membership.admin.invite",
  tenantMembershipAdminSuspend: "tenant.membership.admin.suspend",
  tenantMembershipAdminRevoke: "tenant.membership.admin.revoke",
  tenantMembershipOwnerPromote: "tenant.membership.owner.promote",
  tenantMembershipOwnerDemote: "tenant.membership.owner.demote",
  tenantSecuritySessionRead: "tenant.security.session.read",
  tenantSecuritySessionRevoke: "tenant.security.session.revoke",
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

export const PERMISSIONS = PERMISSION_KEYS;
export type Permission = PermissionKey;
