import { normalizeEmail, PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";
import { isActiveTenantAuthorizationContext } from "../../../authorization/domain/active-tenant-authorization.js";
import { membershipTargetAllowed } from "../../../authorization/domain/membership-target.policy.js";
import type { TenantTransactionPort } from "../../../tenancy/application/ports/tenant-transaction.port.js";
import { RoleGrantNotAllowedError } from "../../domain/membership-errors.js";
import type { TenantAdminInvitationWorkflowPort } from "../ports/tenant-admin-invitation-workflow.port.js";

export type InviteTenantAdminCommand = Readonly<{
  authorization: AuthorizationContext;
  hostname: string;
  email: string;
  requestId: string;
}>;

function canonicalHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

export class InviteTenantAdminUseCase {
  constructor(
    private readonly workflow: TenantAdminInvitationWorkflowPort,
    private readonly transactions: TenantTransactionPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: InviteTenantAdminCommand): Promise<{ readonly accepted: true }> {
    if (
      !isActiveTenantAuthorizationContext(command.authorization) ||
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
    const authorization = command.authorization;

    const displayEmail = command.email.trim().normalize("NFC");
    const normalizedEmail = normalizeEmail(displayEmail);

    return this.transactions.run(
      {
        tenantId: authorization.scope.tenantId,
        actorId: authorization.userId,
        sessionId: authorization.sessionId,
        authorization,
        requestId: command.requestId,
        traceId: command.requestId,
        source: "console",
      },
      () =>
        this.workflow.inviteTenantAdmin({
          actorUserId: authorization.userId,
          tenantId: authorization.scope.tenantId,
          hostname: canonicalHostname(command.hostname),
          normalizedEmail,
          displayEmail,
          requestId: command.requestId,
          now: this.clock(),
        }),
    );
  }
}
