export const AUTHORIZATION_ROLE_KEYS = [
  "platform_admin",
  "tenant_owner",
  "tenant_admin",
  "partner_owner",
  "partner_admin",
] as const;

export type AuthorizationRoleKey = (typeof AUTHORIZATION_ROLE_KEYS)[number];

export const AUTHORIZATION_PERMISSION_KEYS = [
  "platform.security.audit.read",
  "platform.security.session.revoke",
  "platform.tenants.provision",
  "platform.users.provision",
  "tenant.membership.read",
  "tenant.membership.admin.invite",
  "tenant.membership.admin.suspend",
  "tenant.membership.admin.revoke",
  "tenant.membership.owner.promote",
  "tenant.membership.owner.demote",
  "tenant.security.session.read",
  "tenant.security.session.revoke",
  "tenant.rbac.permission.read",
  "tenant.rbac.role.read",
  "tenant.rbac.role.create",
  "tenant.rbac.role.update",
  "tenant.rbac.role.archive",
  "tenant.rbac.role.permission.grant",
  "tenant.rbac.role.permission.revoke",
  "tenant.rbac.assignment.read",
  "tenant.rbac.assignment.grant",
  "tenant.rbac.assignment.revoke",
  "partner.profile.read",
  "partner.profile.update",
  "partner.application.read",
  "partner.application.submit",
  "partner.verification.read",
  "partner.verification.update",
  "partner.payout_account.read",
  "partner.payout_account.update",
  "partner.review_finding.read",
  "tenant.partner.read",
  "tenant.partner.verification.read",
  "tenant.partner.payout_account.read",
  "tenant.partner.application.review",
  "tenant.partner.application.approve",
  "tenant.partner.application.reject",
  "tenant.partner.lifecycle.suspend",
  "tenant.partner.lifecycle.reactivate",
  "tenant.partner.lifecycle.cancel",
] as const;

export type AuthorizationPermissionKey = (typeof AUTHORIZATION_PERMISSION_KEYS)[number];

export interface AuthorizationContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly scope:
    | { readonly type: "platform" }
    | {
        readonly type: "tenant";
        readonly tenantId: string;
        readonly tenantSlug: string;
      }
    | {
        readonly type: "partner";
        readonly tenantId: string;
        readonly tenantSlug: string;
        readonly partnerId: string;
      };
  readonly membershipId?: string;
  readonly membershipStatus?: "active";
  readonly roleKeys: readonly AuthorizationRoleKey[];
  readonly permissionKeys: readonly AuthorizationPermissionKey[];
  readonly userAuthorizationVersion: number;
  readonly membershipAuthorizationVersion?: number;
}

export type ActiveTenantAuthorizationContext = AuthorizationContext & {
  readonly scope: {
    readonly type: "tenant";
    readonly tenantId: string;
    readonly tenantSlug: string;
  };
  readonly membershipId: string;
  readonly membershipStatus: "active";
  readonly membershipAuthorizationVersion: number;
};
