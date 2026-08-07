import { SYSTEM_ROLES, type SystemRole } from "./roles.js";

export type GrantAction = "invite" | "promote" | "demote" | "suspend" | "revoke";

export interface GrantRoleInput {
  readonly actorRoles: readonly SystemRole[];
  readonly targetCurrentRoles: readonly SystemRole[];
  readonly requestedRole: SystemRole;
  readonly action: GrantAction;
}

export interface GrantDecision {
  readonly allowed: boolean;
}

const DENIED: GrantDecision = Object.freeze({ allowed: false });
const ALLOWED: GrantDecision = Object.freeze({ allowed: true });

function hasRole(roles: readonly SystemRole[], role: SystemRole): boolean {
  return roles.includes(role);
}

function isTenantAdminTarget(input: GrantRoleInput): boolean {
  return (
    input.requestedRole === SYSTEM_ROLES.tenantAdmin &&
    hasRole(input.targetCurrentRoles, SYSTEM_ROLES.tenantAdmin) &&
    !hasRole(input.targetCurrentRoles, SYSTEM_ROLES.tenantOwner)
  );
}

export function canGrantRole(input: GrantRoleInput): GrantDecision {
  if (
    input.requestedRole === SYSTEM_ROLES.platformAdmin ||
    hasRole(input.targetCurrentRoles, SYSTEM_ROLES.platformAdmin)
  ) {
    return DENIED;
  }

  if (hasRole(input.actorRoles, SYSTEM_ROLES.platformAdmin)) {
    return input.action === "invite" &&
      input.requestedRole === SYSTEM_ROLES.tenantOwner &&
      input.targetCurrentRoles.length === 0
      ? ALLOWED
      : DENIED;
  }

  if (hasRole(input.actorRoles, SYSTEM_ROLES.tenantOwner)) {
    if (
      input.action === "invite" &&
      input.requestedRole === SYSTEM_ROLES.tenantAdmin &&
      input.targetCurrentRoles.length === 0
    ) {
      return ALLOWED;
    }

    if (
      input.action === "promote" &&
      input.requestedRole === SYSTEM_ROLES.tenantOwner &&
      hasRole(input.targetCurrentRoles, SYSTEM_ROLES.tenantAdmin) &&
      !hasRole(input.targetCurrentRoles, SYSTEM_ROLES.tenantOwner)
    ) {
      return ALLOWED;
    }

    if (
      input.action === "demote" &&
      input.requestedRole === SYSTEM_ROLES.tenantAdmin &&
      hasRole(input.targetCurrentRoles, SYSTEM_ROLES.tenantOwner)
    ) {
      return ALLOWED;
    }

    if ((input.action === "suspend" || input.action === "revoke") && isTenantAdminTarget(input)) {
      return ALLOWED;
    }

    return DENIED;
  }

  if (hasRole(input.actorRoles, SYSTEM_ROLES.tenantAdmin)) {
    if (
      input.action === "invite" &&
      input.requestedRole === SYSTEM_ROLES.tenantAdmin &&
      input.targetCurrentRoles.length === 0
    ) {
      return ALLOWED;
    }

    if ((input.action === "suspend" || input.action === "revoke") && isTenantAdminTarget(input)) {
      return ALLOWED;
    }
  }

  return DENIED;
}
