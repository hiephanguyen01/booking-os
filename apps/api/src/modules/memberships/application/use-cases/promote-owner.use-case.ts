import { PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";
import { isActiveTenantAuthorizationContext } from "../../../authorization/domain/active-tenant-authorization.js";
import { membershipTargetAllowed } from "../../../authorization/domain/membership-target.policy.js";
import type { TenantTransactionPort } from "../../../tenancy/application/ports/tenant-transaction.port.js";
import {
  MembershipInactiveError,
  MembershipRequiredError,
  RoleGrantNotAllowedError,
} from "../../domain/membership-errors.js";

export interface PromoteOwnerCommand {
  readonly authorization: AuthorizationContext;
  readonly membershipId: string;
  readonly requestId: string;
}

export interface PromoteOwnerResult {
  readonly membershipId: string;
  readonly roleKey: typeof SYSTEM_ROLES.tenantOwner;
  readonly authorizationVersion: number;
  readonly revokedSessionCount: number;
}

export class PromoteOwnerUseCase {
  constructor(
    private readonly transactions: TenantTransactionPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: PromoteOwnerCommand): Promise<PromoteOwnerResult> {
    const authorization = command.authorization;
    if (
      !isActiveTenantAuthorizationContext(authorization) ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantMembershipOwnerPromote)
    ) {
      throw new RoleGrantNotAllowedError();
    }

    const now = this.clock();
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
      async (session) => {
        const membership = await session.memberships.lockById(command.membershipId);
        if (!membership) throw new MembershipRequiredError();
        if (membership.status !== "active") throw new MembershipInactiveError();

        const targetRoles = await session.roles.listActiveRoleKeys(membership.userId);
        if (
          !membershipTargetAllowed({
            action: "promote",
            actorMembershipId: authorization.membershipId,
            targetMembershipId: membership.id,
            actorRoles: authorization.roleKeys,
            targetRoles,
          })
        ) {
          throw new RoleGrantNotAllowedError();
        }

        await session.roles.revoke({
          userId: membership.userId,
          roleKey: SYSTEM_ROLES.tenantAdmin,
          now,
        });
        await session.roles.assign({
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
          eventType: "membership.owner_promoted",
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
          roleKey: SYSTEM_ROLES.tenantOwner,
          authorizationVersion,
          revokedSessionCount,
        });
      },
    );
  }
}
