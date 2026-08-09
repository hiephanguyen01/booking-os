import { SYSTEM_ROLES, type SystemRole } from "@booking-os/auth";

export interface TenantSessionRevocationPolicyInput {
  readonly actorUserId: string;
  readonly targetUserId: string;
  readonly actorRoles: readonly SystemRole[];
  readonly targetRoles: readonly SystemRole[];
}

export function tenantSessionRevocationAllowed(input: TenantSessionRevocationPolicyInput): boolean {
  if (input.actorUserId === input.targetUserId) return false;
  if (input.actorRoles.includes(SYSTEM_ROLES.platformAdmin)) return false;
  const actorCanAdminister = input.actorRoles.some(
    (role) => role === SYSTEM_ROLES.tenantOwner || role === SYSTEM_ROLES.tenantAdmin,
  );
  const targetIsAdminOnly =
    input.targetRoles.includes(SYSTEM_ROLES.tenantAdmin) &&
    !input.targetRoles.includes(SYSTEM_ROLES.tenantOwner) &&
    !input.targetRoles.includes(SYSTEM_ROLES.platformAdmin);
  return actorCanAdminister && targetIsAdminOnly;
}
