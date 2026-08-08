import type { SystemRole } from "@booking-os/auth";

import { InvitationInvalidOrExpiredError } from "../../domain/membership-errors.js";
import type { TenantAdminInvitationWorkflowPort } from "../ports/tenant-admin-invitation-workflow.port.js";

export type GetCurrentInvitationCommand = Readonly<{
  tenantId: string;
  userId: string;
  hostname: string;
}>;

export type CurrentInvitationResult = Readonly<{
  invitationId: string;
  tenantId: string;
  intendedRoleKey: SystemRole;
  hostname: string;
  expiresAt: Date;
}>;

function canonicalHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export class GetCurrentInvitationUseCase {
  constructor(
    private readonly workflow: TenantAdminInvitationWorkflowPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: GetCurrentInvitationCommand): Promise<CurrentInvitationResult> {
    const hostname = canonicalHostname(command.hostname);
    const now = this.clock();
    const invitation = await this.workflow.getCurrentInvitation({
      tenantId: command.tenantId,
      userId: command.userId,
      hostname,
      now,
    });

    if (
      !invitation ||
      invitation.tenantId !== command.tenantId ||
      invitation.invitedUserId !== command.userId ||
      invitation.hostname !== hostname ||
      invitation.expiresAt.getTime() <= now.getTime()
    ) {
      throw new InvitationInvalidOrExpiredError();
    }

    return Object.freeze({
      invitationId: invitation.id,
      tenantId: invitation.tenantId,
      intendedRoleKey: invitation.intendedRoleKey,
      hostname: invitation.hostname,
      expiresAt: invitation.expiresAt,
    });
  }
}
