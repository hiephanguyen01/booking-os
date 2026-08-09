import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import { membershipTargetAllowed } from "../../../authorization/domain/membership-target.policy.js";
import type { TenantTransactionPort } from "../../../tenancy/application/ports/tenant-transaction.port.js";
import {
  MembershipInactiveError,
  MembershipRequiredError,
  RoleGrantNotAllowedError,
} from "../../domain/membership-errors.js";

export interface RevokeMembershipCommand {
  readonly authorization: AuthorizationContext;
  readonly membershipId: string;
  readonly requestId: string;
}

export interface RevokeMembershipResult {
  readonly membershipId: string;
  readonly status: "revoked";
  readonly authorizationVersion: number;
  readonly revokedSessionCount: number;
}

export class RevokeMembershipUseCase {
  constructor(
    private readonly transactions: TenantTransactionPort,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async execute(command: RevokeMembershipCommand): Promise<RevokeMembershipResult> {
    const authorization = command.authorization;
    if (
      authorization.scope.type !== "tenant" ||
      authorization.membershipStatus !== "active" ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantMembershipAdminRevoke) ||
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
        if (membership.status !== "active" && membership.status !== "suspended") {
          throw new MembershipInactiveError();
        }

        const targetRoles = await session.roles.listActiveRoleKeys(membership.userId);
        if (
          !membershipTargetAllowed({
            action: "revoke",
            actorMembershipId: authorization.membershipId,
            targetMembershipId: membership.id,
            actorRoles: authorization.roleKeys,
            targetRoles,
          })
        ) {
          throw new RoleGrantNotAllowedError();
        }

        const revoked = await session.memberships.revoke(membership.id, now);
        const revokedSessionCount = await session.sessions.revokeTenantSessionsForUser({
          userId: membership.userId,
          revokedAt: now,
          reason: "membership_revoked",
        });
        await session.audit.append({
          eventType: "membership.revoked",
          actorUserId: authorization.userId,
          subjectUserId: membership.userId,
          requestId: command.requestId,
          metadata: {
            membershipId: membership.id,
            authorizationVersion: revoked.authorizationVersion,
            revokedSessionCount,
          },
          occurredAt: now,
        });

        return Object.freeze({
          membershipId: membership.id,
          status: "revoked" as const,
          authorizationVersion: revoked.authorizationVersion,
          revokedSessionCount,
        });
      },
    );
  }
}
