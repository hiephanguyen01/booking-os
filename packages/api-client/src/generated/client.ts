// AUTO-GENERATED. DO NOT EDIT. Run pnpm api:generate.
import type { operations } from "./schema.js";

export interface GeneratedRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface GeneratedRequestOptions {
  readonly signal?: AbortSignal;
}

export type GeneratedTransport = <TResponse>(
  request: GeneratedRequest,
  options?: GeneratedRequestOptions,
) => Promise<TResponse>;

export interface CompleteAccountActivationParameters {
  readonly body: operations["completeAccountActivation"]["requestBody"]["content"]["application/json"];
}

export interface GetPreAuthCsrfParameters {
  readonly query: operations["getPreAuthCsrf"]["parameters"]["query"];
}

export interface LoginSessionParameters {
  readonly body: operations["loginSession"]["requestBody"]["content"]["application/json"];
}

export interface RequestPasswordResetParameters {
  readonly body: operations["requestPasswordReset"]["requestBody"]["content"]["application/json"];
}

export interface CompletePasswordResetParameters {
  readonly body: operations["completePasswordReset"]["requestBody"]["content"]["application/json"];
}

export interface RevokeSessionParameters {
  readonly path: operations["revokeSession"]["parameters"]["path"];
}

export interface CreateTenantAdminInvitationParameters {
  readonly body: operations["createTenantAdminInvitation"]["requestBody"]["content"]["application/json"];
}

export interface AcceptMembershipInvitationParameters {
  readonly body: operations["acceptMembershipInvitation"]["requestBody"]["content"]["application/json"];
}

export interface ResendTenantAdminInvitationParameters {
  readonly path: operations["resendTenantAdminInvitation"]["parameters"]["path"];
}

export interface DemoteTenantMembershipOwnerParameters {
  readonly path: operations["demoteTenantMembershipOwner"]["parameters"]["path"];
}

export interface PromoteTenantMembershipOwnerParameters {
  readonly path: operations["promoteTenantMembershipOwner"]["parameters"]["path"];
}

export interface RevokeTenantMembershipParameters {
  readonly path: operations["revokeTenantMembership"]["parameters"]["path"];
}

export interface SuspendTenantMembershipParameters {
  readonly path: operations["suspendTenantMembership"]["parameters"]["path"];
}

export interface RevokePlatformUserSessionsParameters {
  readonly path: operations["revokePlatformUserSessions"]["parameters"]["path"];
  readonly body: operations["revokePlatformUserSessions"]["requestBody"]["content"]["application/json"];
}

export interface ProvisionPlatformTenantParameters {
  readonly headers: operations["provisionPlatformTenant"]["parameters"]["header"];
  readonly body: operations["provisionPlatformTenant"]["requestBody"]["content"]["application/json"];
}

export interface GetPlatformTenantProvisioningParameters {
  readonly path: operations["getPlatformTenantProvisioning"]["parameters"]["path"];
}

export interface ResendPlatformTenantOwnerInvitationParameters {
  readonly path: operations["resendPlatformTenantOwnerInvitation"]["parameters"]["path"];
}

export interface ListTenantMembershipRbacRolesParameters {
  readonly path: operations["listTenantMembershipRbacRoles"]["parameters"]["path"];
}

export interface GrantTenantMembershipRbacRoleParameters {
  readonly path: operations["grantTenantMembershipRbacRole"]["parameters"]["path"];
}

export interface RevokeTenantMembershipRbacRoleParameters {
  readonly path: operations["revokeTenantMembershipRbacRole"]["parameters"]["path"];
}

export interface CreateTenantRbacRoleParameters {
  readonly body: operations["createTenantRbacRole"]["requestBody"]["content"]["application/json"];
}

export interface GetTenantRbacRoleParameters {
  readonly path: operations["getTenantRbacRole"]["parameters"]["path"];
}

export interface ArchiveTenantRbacRoleParameters {
  readonly path: operations["archiveTenantRbacRole"]["parameters"]["path"];
  readonly body: operations["archiveTenantRbacRole"]["requestBody"]["content"]["application/json"];
}

export interface UpdateTenantRbacRoleParameters {
  readonly path: operations["updateTenantRbacRole"]["parameters"]["path"];
  readonly body: operations["updateTenantRbacRole"]["requestBody"]["content"]["application/json"];
}

export interface ReplaceTenantRbacRolePermissionsParameters {
  readonly path: operations["replaceTenantRbacRolePermissions"]["parameters"]["path"];
  readonly body: operations["replaceTenantRbacRolePermissions"]["requestBody"]["content"]["application/json"];
}

export interface GeneratedClient {
  readonly completeAccountActivation: (parameters: CompleteAccountActivationParameters, options?: GeneratedRequestOptions) => Promise<operations["completeAccountActivation"]["responses"][200]["content"]["application/json"]>;
  readonly getPreAuthCsrf: (parameters: GetPreAuthCsrfParameters, options?: GeneratedRequestOptions) => Promise<operations["getPreAuthCsrf"]["responses"][200]["content"]["application/json"]>;
  readonly loginSession: (parameters: LoginSessionParameters, options?: GeneratedRequestOptions) => Promise<operations["loginSession"]["responses"][200]["content"]["application/json"]>;
  readonly logoutSession: (options?: GeneratedRequestOptions) => Promise<operations["logoutSession"]["responses"][200]["content"]["application/json"]>;
  readonly getCurrentSession: (options?: GeneratedRequestOptions) => Promise<operations["getCurrentSession"]["responses"][200]["content"]["application/json"]>;
  readonly getCurrentAuthorization: (options?: GeneratedRequestOptions) => Promise<operations["getCurrentAuthorization"]["responses"][200]["content"]["application/json"]>;
  readonly requestPasswordReset: (parameters: RequestPasswordResetParameters, options?: GeneratedRequestOptions) => Promise<operations["requestPasswordReset"]["responses"][202]["content"]["application/json"]>;
  readonly completePasswordReset: (parameters: CompletePasswordResetParameters, options?: GeneratedRequestOptions) => Promise<operations["completePasswordReset"]["responses"][200]["content"]["application/json"]>;
  readonly getSessionCsrf: (options?: GeneratedRequestOptions) => Promise<operations["getSessionCsrf"]["responses"][200]["content"]["application/json"]>;
  readonly refreshSession: (options?: GeneratedRequestOptions) => Promise<operations["refreshSession"]["responses"][200]["content"]["application/json"]>;
  readonly listSessions: (options?: GeneratedRequestOptions) => Promise<operations["listSessions"]["responses"][200]["content"]["application/json"]>;
  readonly revokeOtherSessions: (options?: GeneratedRequestOptions) => Promise<operations["revokeOtherSessions"]["responses"][200]["content"]["application/json"]>;
  readonly revokeSession: (parameters: RevokeSessionParameters, options?: GeneratedRequestOptions) => Promise<operations["revokeSession"]["responses"][200]["content"]["application/json"]>;
  readonly getHealth: (options?: GeneratedRequestOptions) => Promise<operations["getHealth"]["responses"][200]["content"]["application/json"]>;
  readonly createTenantAdminInvitation: (parameters: CreateTenantAdminInvitationParameters, options?: GeneratedRequestOptions) => Promise<operations["createTenantAdminInvitation"]["responses"][202]["content"]["application/json"]>;
  readonly acceptMembershipInvitation: (parameters: AcceptMembershipInvitationParameters, options?: GeneratedRequestOptions) => Promise<operations["acceptMembershipInvitation"]["responses"][200]["content"]["application/json"]>;
  readonly getCurrentMembershipInvitation: (options?: GeneratedRequestOptions) => Promise<operations["getCurrentMembershipInvitation"]["responses"][200]["content"]["application/json"]>;
  readonly resendTenantAdminInvitation: (parameters: ResendTenantAdminInvitationParameters, options?: GeneratedRequestOptions) => Promise<operations["resendTenantAdminInvitation"]["responses"][202]["content"]["application/json"]>;
  readonly listTenantMemberships: (options?: GeneratedRequestOptions) => Promise<operations["listTenantMemberships"]["responses"][200]["content"]["application/json"]>;
  readonly demoteTenantMembershipOwner: (parameters: DemoteTenantMembershipOwnerParameters, options?: GeneratedRequestOptions) => Promise<operations["demoteTenantMembershipOwner"]["responses"][200]["content"]["application/json"]>;
  readonly promoteTenantMembershipOwner: (parameters: PromoteTenantMembershipOwnerParameters, options?: GeneratedRequestOptions) => Promise<operations["promoteTenantMembershipOwner"]["responses"][200]["content"]["application/json"]>;
  readonly revokeTenantMembership: (parameters: RevokeTenantMembershipParameters, options?: GeneratedRequestOptions) => Promise<operations["revokeTenantMembership"]["responses"][200]["content"]["application/json"]>;
  readonly suspendTenantMembership: (parameters: SuspendTenantMembershipParameters, options?: GeneratedRequestOptions) => Promise<operations["suspendTenantMembership"]["responses"][200]["content"]["application/json"]>;
  readonly revokePlatformUserSessions: (parameters: RevokePlatformUserSessionsParameters, options?: GeneratedRequestOptions) => Promise<operations["revokePlatformUserSessions"]["responses"][200]["content"]["application/json"]>;
  readonly provisionPlatformTenant: (parameters: ProvisionPlatformTenantParameters, options?: GeneratedRequestOptions) => Promise<operations["provisionPlatformTenant"]["responses"][200]["content"]["application/json"]>;
  readonly getPlatformTenantProvisioning: (parameters: GetPlatformTenantProvisioningParameters, options?: GeneratedRequestOptions) => Promise<operations["getPlatformTenantProvisioning"]["responses"][200]["content"]["application/json"]>;
  readonly resendPlatformTenantOwnerInvitation: (parameters: ResendPlatformTenantOwnerInvitationParameters, options?: GeneratedRequestOptions) => Promise<operations["resendPlatformTenantOwnerInvitation"]["responses"][202]["content"]["application/json"]>;
  readonly getReadiness: (options?: GeneratedRequestOptions) => Promise<operations["getReadiness"]["responses"][200]["content"]["application/json"]>;
  readonly listTenantMembershipRbacRoles: (parameters: ListTenantMembershipRbacRolesParameters, options?: GeneratedRequestOptions) => Promise<operations["listTenantMembershipRbacRoles"]["responses"][200]["content"]["application/json"]>;
  readonly grantTenantMembershipRbacRole: (parameters: GrantTenantMembershipRbacRoleParameters, options?: GeneratedRequestOptions) => Promise<operations["grantTenantMembershipRbacRole"]["responses"][200]["content"]["application/json"]>;
  readonly revokeTenantMembershipRbacRole: (parameters: RevokeTenantMembershipRbacRoleParameters, options?: GeneratedRequestOptions) => Promise<operations["revokeTenantMembershipRbacRole"]["responses"][200]["content"]["application/json"]>;
  readonly listTenantRbacPermissions: (options?: GeneratedRequestOptions) => Promise<operations["listTenantRbacPermissions"]["responses"][200]["content"]["application/json"]>;
  readonly listTenantRbacRoles: (options?: GeneratedRequestOptions) => Promise<operations["listTenantRbacRoles"]["responses"][200]["content"]["application/json"]>;
  readonly createTenantRbacRole: (parameters: CreateTenantRbacRoleParameters, options?: GeneratedRequestOptions) => Promise<operations["createTenantRbacRole"]["responses"][201]["content"]["application/json"]>;
  readonly getTenantRbacRole: (parameters: GetTenantRbacRoleParameters, options?: GeneratedRequestOptions) => Promise<operations["getTenantRbacRole"]["responses"][200]["content"]["application/json"]>;
  readonly archiveTenantRbacRole: (parameters: ArchiveTenantRbacRoleParameters, options?: GeneratedRequestOptions) => Promise<operations["archiveTenantRbacRole"]["responses"][200]["content"]["application/json"]>;
  readonly updateTenantRbacRole: (parameters: UpdateTenantRbacRoleParameters, options?: GeneratedRequestOptions) => Promise<operations["updateTenantRbacRole"]["responses"][200]["content"]["application/json"]>;
  readonly replaceTenantRbacRolePermissions: (parameters: ReplaceTenantRbacRolePermissionsParameters, options?: GeneratedRequestOptions) => Promise<operations["replaceTenantRbacRolePermissions"]["responses"][200]["content"]["application/json"]>;
}

export function createGeneratedClient(transport: GeneratedTransport): GeneratedClient {
  return {
    async completeAccountActivation(parameters, options) {
      return transport<operations["completeAccountActivation"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/auth/activation/complete",
      body: parameters.body,
      }, options);
    },
    async getPreAuthCsrf(parameters, options) {
      return transport<operations["getPreAuthCsrf"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/auth/csrf",
      query: parameters.query,
      }, options);
    },
    async loginSession(parameters, options) {
      return transport<operations["loginSession"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/auth/login",
      body: parameters.body,
      }, options);
    },
    async logoutSession(options) {
      return transport<operations["logoutSession"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/auth/logout",
      }, options);
    },
    async getCurrentSession(options) {
      return transport<operations["getCurrentSession"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/auth/me",
      }, options);
    },
    async getCurrentAuthorization(options) {
      return transport<operations["getCurrentAuthorization"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/auth/me/authorization",
      }, options);
    },
    async requestPasswordReset(parameters, options) {
      return transport<operations["requestPasswordReset"]["responses"][202]["content"]["application/json"]>({
      method: "POST",
      path: "/api/auth/password/forgot",
      body: parameters.body,
      }, options);
    },
    async completePasswordReset(parameters, options) {
      return transport<operations["completePasswordReset"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/auth/password/reset",
      body: parameters.body,
      }, options);
    },
    async getSessionCsrf(options) {
      return transport<operations["getSessionCsrf"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/auth/session/csrf",
      }, options);
    },
    async refreshSession(options) {
      return transport<operations["refreshSession"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/auth/session/refresh",
      }, options);
    },
    async listSessions(options) {
      return transport<operations["listSessions"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/auth/sessions",
      }, options);
    },
    async revokeOtherSessions(options) {
      return transport<operations["revokeOtherSessions"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/auth/sessions/revoke-others",
      }, options);
    },
    async revokeSession(parameters, options) {
      return transport<operations["revokeSession"]["responses"][200]["content"]["application/json"]>({
      method: "DELETE",
      path: `/api/auth/sessions/${encodeURIComponent(String(parameters.path.sessionId))}`,
      }, options);
    },
    async getHealth(options) {
      return transport<operations["getHealth"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/health",
      }, options);
    },
    async createTenantAdminInvitation(parameters, options) {
      return transport<operations["createTenantAdminInvitation"]["responses"][202]["content"]["application/json"]>({
      method: "POST",
      path: "/api/membership/invitations",
      body: parameters.body,
      }, options);
    },
    async acceptMembershipInvitation(parameters, options) {
      return transport<operations["acceptMembershipInvitation"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/membership/invitations/accept",
      body: parameters.body,
      }, options);
    },
    async getCurrentMembershipInvitation(options) {
      return transport<operations["getCurrentMembershipInvitation"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/membership/invitations/current",
      }, options);
    },
    async resendTenantAdminInvitation(parameters, options) {
      return transport<operations["resendTenantAdminInvitation"]["responses"][202]["content"]["application/json"]>({
      method: "POST",
      path: `/api/membership/invitations/${encodeURIComponent(String(parameters.path.invitationId))}/resend`,
      }, options);
    },
    async listTenantMemberships(options) {
      return transport<operations["listTenantMemberships"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/memberships",
      }, options);
    },
    async demoteTenantMembershipOwner(parameters, options) {
      return transport<operations["demoteTenantMembershipOwner"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: `/api/memberships/${encodeURIComponent(String(parameters.path.membershipId))}/demote-owner`,
      }, options);
    },
    async promoteTenantMembershipOwner(parameters, options) {
      return transport<operations["promoteTenantMembershipOwner"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: `/api/memberships/${encodeURIComponent(String(parameters.path.membershipId))}/promote-owner`,
      }, options);
    },
    async revokeTenantMembership(parameters, options) {
      return transport<operations["revokeTenantMembership"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: `/api/memberships/${encodeURIComponent(String(parameters.path.membershipId))}/revoke`,
      }, options);
    },
    async suspendTenantMembership(parameters, options) {
      return transport<operations["suspendTenantMembership"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: `/api/memberships/${encodeURIComponent(String(parameters.path.membershipId))}/suspend`,
      }, options);
    },
    async revokePlatformUserSessions(parameters, options) {
      return transport<operations["revokePlatformUserSessions"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: `/api/platform/security/users/${encodeURIComponent(String(parameters.path.userId))}/sessions/revoke`,
      body: parameters.body,
      }, options);
    },
    async provisionPlatformTenant(parameters, options) {
      return transport<operations["provisionPlatformTenant"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/platform/tenants",
      headers: parameters.headers,
      body: parameters.body,
      }, options);
    },
    async getPlatformTenantProvisioning(parameters, options) {
      return transport<operations["getPlatformTenantProvisioning"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: `/api/platform/tenants/${encodeURIComponent(String(parameters.path.tenantId))}`,
      }, options);
    },
    async resendPlatformTenantOwnerInvitation(parameters, options) {
      return transport<operations["resendPlatformTenantOwnerInvitation"]["responses"][202]["content"]["application/json"]>({
      method: "POST",
      path: `/api/platform/tenants/${encodeURIComponent(String(parameters.path.tenantId))}/owner-invitation/resend`,
      }, options);
    },
    async getReadiness(options) {
      return transport<operations["getReadiness"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/ready",
      }, options);
    },
    async listTenantMembershipRbacRoles(parameters, options) {
      return transport<operations["listTenantMembershipRbacRoles"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: `/api/tenant/rbac/memberships/${encodeURIComponent(String(parameters.path.membershipId))}/roles`,
      }, options);
    },
    async grantTenantMembershipRbacRole(parameters, options) {
      return transport<operations["grantTenantMembershipRbacRole"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: `/api/tenant/rbac/memberships/${encodeURIComponent(String(parameters.path.membershipId))}/roles/${encodeURIComponent(String(parameters.path.roleId))}`,
      }, options);
    },
    async revokeTenantMembershipRbacRole(parameters, options) {
      return transport<operations["revokeTenantMembershipRbacRole"]["responses"][200]["content"]["application/json"]>({
      method: "DELETE",
      path: `/api/tenant/rbac/memberships/${encodeURIComponent(String(parameters.path.membershipId))}/roles/${encodeURIComponent(String(parameters.path.roleId))}`,
      }, options);
    },
    async listTenantRbacPermissions(options) {
      return transport<operations["listTenantRbacPermissions"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/tenant/rbac/permissions",
      }, options);
    },
    async listTenantRbacRoles(options) {
      return transport<operations["listTenantRbacRoles"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/tenant/rbac/roles",
      }, options);
    },
    async createTenantRbacRole(parameters, options) {
      return transport<operations["createTenantRbacRole"]["responses"][201]["content"]["application/json"]>({
      method: "POST",
      path: "/api/tenant/rbac/roles",
      body: parameters.body,
      }, options);
    },
    async getTenantRbacRole(parameters, options) {
      return transport<operations["getTenantRbacRole"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: `/api/tenant/rbac/roles/${encodeURIComponent(String(parameters.path.roleId))}`,
      }, options);
    },
    async archiveTenantRbacRole(parameters, options) {
      return transport<operations["archiveTenantRbacRole"]["responses"][200]["content"]["application/json"]>({
      method: "DELETE",
      path: `/api/tenant/rbac/roles/${encodeURIComponent(String(parameters.path.roleId))}`,
      body: parameters.body,
      }, options);
    },
    async updateTenantRbacRole(parameters, options) {
      return transport<operations["updateTenantRbacRole"]["responses"][200]["content"]["application/json"]>({
      method: "PATCH",
      path: `/api/tenant/rbac/roles/${encodeURIComponent(String(parameters.path.roleId))}`,
      body: parameters.body,
      }, options);
    },
    async replaceTenantRbacRolePermissions(parameters, options) {
      return transport<operations["replaceTenantRbacRolePermissions"]["responses"][200]["content"]["application/json"]>({
      method: "PUT",
      path: `/api/tenant/rbac/roles/${encodeURIComponent(String(parameters.path.roleId))}/permissions`,
      body: parameters.body,
      }, options);
    },
  };
}
