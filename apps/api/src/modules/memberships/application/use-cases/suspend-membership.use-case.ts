import { canGrantRole, PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../tenancy/application/ports/tenant-transaction.port.js";
import {
  MembershipInactiveError,
  MembershipRequiredError,
  RoleGrantNotAllowedError,
} from "../../domain/membership-errors.js";

export interface SuspendMembershipCommand {
  readonly authorization: AuthorizationContext;
  readonly membershipId: string;
  readonly requestId: string;
}

export interface SuspendMembershipResult {
  readonly membershipId: string;
  readonly status: "suspended";
  readonly authorizationVersion: number;
  readonly revokedSessionCount: number;
}

export class SuspendMembershipUseCase {
  constructor(
    private readonly transactions: TenantTransactionPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: SuspendMembershipCommand): Promise<SuspendMembershipResult> {
    const authorization = command.authorization;
    if (
      authorization.scope.type !== "tenant" ||
      authorization.membershipStatus !== "active" ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantMembershipAdminSuspend) ||
      authorization.membershipId === command.membershipId
    ) {
      throw new RoleGrantNotAllowedError();
    }

    const now = this.clock();
    return this.transactions.run(
      {
        tenantId: authorization.scope.tenantId,
        actorId: authorization.userId,
        requestId: command.requestId,
        traceId: command.requestId,
        source: "console",
      },
      async (session) => {
        const membership = await session.memberships.lockById(command.membershipId);
        if (!membership) throw new MembershipRequiredError();
        if (membership.status !== "active") throw new MembershipInactiveError();

        const targetRoles = await session.roles.listActiveRoleKeys(membership.userId);
        if (
          !canGrantRole({
            actorRoles: authorization.roleKeys,
            targetCurrentRoles: targetRoles,
            requestedRole: SYSTEM_ROLES.tenantAdmin,
            action: "suspend",
          }).allowed
        ) {
          throw new RoleGrantNotAllowedError();
        }

        const suspended = await session.memberships.suspend(membership.id, now);
        const revokedSessionCount = await session.sessions.revokeTenantSessionsForUser({
          userId: membership.userId,
          revokedAt: now,
          reason: "membership_suspended",
        });
        await session.audit.append({
          eventType: "membership.suspended",
          actorUserId: authorization.userId,
          subjectUserId: membership.userId,
          requestId: command.requestId,
          metadata: {
            membershipId: membership.id,
            authorizationVersion: suspended.authorizationVersion,
            revokedSessionCount,
          },
          occurredAt: now,
        });

        return Object.freeze({
          membershipId: membership.id,
          status: "suspended" as const,
          authorizationVersion: suspended.authorizationVersion,
          revokedSessionCount,
        });
      },
    );
  }
}
