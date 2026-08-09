import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import { membershipTargetAllowed } from "../../../authorization/domain/membership-target.policy.js";
import { RoleGrantNotAllowedError } from "../../domain/membership-errors.js";
import type { TenantAdminInvitationWorkflowPort } from "../ports/tenant-admin-invitation-workflow.port.js";

export type ResendInvitationCommand = Readonly<{
  authorization: AuthorizationContext;
  hostname: string;
  invitationId: string;
  requestId: string;
}>;

function canonicalHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export class ResendInvitationUseCase {
  constructor(
    private readonly workflow: TenantAdminInvitationWorkflowPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: ResendInvitationCommand): Promise<{ readonly accepted: true }> {
    if (
      command.authorization.scope.type !== "tenant" ||
      command.authorization.membershipStatus !== "active" ||
      !command.authorization.permissionKeys.includes(PERMISSION_KEYS.tenantMembershipAdminInvite) ||
      !membershipTargetAllowed({
        action: "invite",
        actorMembershipId: command.authorization.membershipId,
        actorRoles: command.authorization.roleKeys,
        targetRoles: [],
      })
    ) {
      throw new RoleGrantNotAllowedError();
    }

    return this.workflow.resendInvitation({
      actorUserId: command.authorization.userId,
      tenantId: command.authorization.scope.tenantId,
      hostname: canonicalHostname(command.hostname),
      invitationId: command.invitationId,
      requestId: command.requestId,
      now: this.clock(),
    });
  }
}
