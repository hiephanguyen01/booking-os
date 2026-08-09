import { canGrantRole, SYSTEM_ROLES, type SystemRole } from "@booking-os/auth";

export type MembershipTargetAction = "invite" | "promote" | "demote" | "suspend" | "revoke";

export interface MembershipTargetPolicyInput {
  readonly action: MembershipTargetAction;
  readonly actorMembershipId?: string | undefined;
  readonly targetMembershipId?: string | undefined;
  readonly actorRoles: readonly SystemRole[];
  readonly targetRoles: readonly SystemRole[];
  readonly activeOwnerCount?: number | undefined;
}

export function membershipTargetAllowed(input: MembershipTargetPolicyInput): boolean {
  if (!input.actorMembershipId) return false;
  if (input.action !== "invite" && !input.targetMembershipId) {
    return false;
  }
  if (
    (input.action === "suspend" || input.action === "revoke") &&
    input.targetMembershipId === input.actorMembershipId
  ) {
    return false;
  }

  switch (input.action) {
    case "invite":
      return canGrantRole({
        actorRoles: input.actorRoles,
        targetCurrentRoles: input.targetRoles,
        requestedRole: SYSTEM_ROLES.tenantAdmin,
        action: "invite",
      }).allowed;
    case "promote":
      return canGrantRole({
        actorRoles: input.actorRoles,
        targetCurrentRoles: input.targetRoles,
        requestedRole: SYSTEM_ROLES.tenantOwner,
        action: "promote",
      }).allowed;
    case "demote":
      return (
        (input.activeOwnerCount ?? 0) > 1 &&
        canGrantRole({
          actorRoles: input.actorRoles,
          targetCurrentRoles: input.targetRoles,
          requestedRole: SYSTEM_ROLES.tenantAdmin,
          action: "demote",
        }).allowed
      );
    case "suspend":
    case "revoke":
      return canGrantRole({
        actorRoles: input.actorRoles,
        targetCurrentRoles: input.targetRoles,
        requestedRole: SYSTEM_ROLES.tenantAdmin,
        action: input.action,
      }).allowed;
  }
}
