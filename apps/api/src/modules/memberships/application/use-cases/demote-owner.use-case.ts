import { canGrantRole, PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../tenancy/application/ports/tenant-transaction.port.js";
import {
  LastTenantOwnerError,
  MembershipInactiveError,
  MembershipRequiredError,
  RoleGrantNotAllowedError,
} from "../../domain/membership-errors.js";

export interface DemoteOwnerCommand {
  readonly authorization: AuthorizationContext;
  readonly membershipId: string;
  readonly requestId: string;
}

export interface DemoteOwnerResult {
  readonly membershipId: string;
  readonly roleKey: typeof SYSTEM_ROLES.tenantAdmin;
  readonly authorizationVersion: number;
  readonly revokedSessionCount: number;
}

export class DemoteOwnerUseCase {
  constructor(
    private readonly transactions: TenantTransactionPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: DemoteOwnerCommand): Promise<DemoteOwnerResult> {
    const authorization = command.authorization;
    if (
      authorization.scope.type !== "tenant" ||
      authorization.membershipStatus !== "active" ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantMembershipOwnerDemote)
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
        const ownerUserIds = await session.roles.lockActiveOwnerUserIds();
        const membership = await session.memberships.lockById(command.membershipId);
        if (!membership) throw new MembershipRequiredError();
        if (membership.status !== "active") throw new MembershipInactiveError();

        const targetRoles = await session.roles.listActiveRoleKeys(membership.userId);
        if (
          !canGrantRole({
            actorRoles: authorization.roleKeys,
            targetCurrentRoles: targetRoles,
            requestedRole: SYSTEM_ROLES.tenantAdmin,
            action: "demote",
          }).allowed ||
          !ownerUserIds.includes(membership.userId)
        ) {
          throw new RoleGrantNotAllowedError();
        }
        if (ownerUserIds.length <= 1) {
          throw new LastTenantOwnerError();
        }

        if (!targetRoles.includes(SYSTEM_ROLES.tenantAdmin)) {
          await session.roles.assign({
            userId: membership.userId,
            roleKey: SYSTEM_ROLES.tenantAdmin,
            now,
          });
        }
        await session.roles.revoke({
          userId: membership.userId,
          roleKey: SYSTEM_ROLES.tenantOwner,
          now,
        });
        const authorizationVersion = await session.memberships.incrementAuthorizationVersion(
          membership.id,
          now,
        );
        const revokedSessionCount = await session.sessions.revokeTenantSessionsForUser({
          userId: membership.userId,
          revokedAt: now,
          reason: "membership_role_changed",
        });
        await session.audit.append({
          eventType: "membership.owner_demoted",
          actorUserId: authorization.userId,
          subjectUserId: membership.userId,
          requestId: command.requestId,
          metadata: {
            membershipId: membership.id,
            authorizationVersion,
            revokedSessionCount,
          },
          occurredAt: now,
        });

        return Object.freeze({
          membershipId: membership.id,
          roleKey: SYSTEM_ROLES.tenantAdmin,
          authorizationVersion,
          revokedSessionCount,
        });
      },
    );
  }
}
