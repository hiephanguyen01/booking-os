export const PERMISSION_KEYS = {
  platformSecurityAuditRead: "platform.security.audit.read",
  platformSecuritySessionRevoke: "platform.security.session.revoke",
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
  tenantRbacPermissionRead: "tenant.rbac.permission.read",
  tenantRbacRoleRead: "tenant.rbac.role.read",
  tenantRbacRoleCreate: "tenant.rbac.role.create",
  tenantRbacRoleUpdate: "tenant.rbac.role.update",
  tenantRbacRoleArchive: "tenant.rbac.role.archive",
  tenantRbacRolePermissionGrant: "tenant.rbac.role.permission.grant",
  tenantRbacRolePermissionRevoke: "tenant.rbac.role.permission.revoke",
  tenantRbacAssignmentRead: "tenant.rbac.assignment.read",
  tenantRbacAssignmentGrant: "tenant.rbac.assignment.grant",
  tenantRbacAssignmentRevoke: "tenant.rbac.assignment.revoke",
  tenantPartnerRead: "tenant.partner.read",
  tenantPartnerReview: "tenant.partner.review",
  tenantPartnerApprove: "tenant.partner.approve",
  tenantPartnerSuspend: "tenant.partner.suspend",
  partnerProfileRead: "partner.profile.read",
  partnerProfileUpdate: "partner.profile.update",
  partnerMembershipRead: "partner.membership.read",
  partnerMembershipInvite: "partner.membership.invite",
  partnerMembershipRevoke: "partner.membership.revoke",
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

export const PERMISSIONS = PERMISSION_KEYS;
export type Permission = PermissionKey;
