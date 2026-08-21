export const AUTHORIZATION_ROLE_KEYS = [
  "platform_admin",
  "tenant_owner",
  "tenant_admin",
  "partner_owner",
  "partner_member",
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
  "tenant.partner.read",
  "tenant.partner.review",
  "tenant.partner.approve",
  "tenant.partner.suspend",
  "partner.profile.read",
  "partner.profile.update",
  "partner.membership.read",
  "partner.membership.invite",
  "partner.membership.revoke",
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
