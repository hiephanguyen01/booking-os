export const AUTHORIZATION_ROLE_KEYS = [
  "platform_admin",
  "tenant_owner",
  "tenant_admin",
] as const;

export type AuthorizationRoleKey = (typeof AUTHORIZATION_ROLE_KEYS)[number];

export const AUTHORIZATION_PERMISSION_KEYS = [
  "platform.security.audit.read",
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
