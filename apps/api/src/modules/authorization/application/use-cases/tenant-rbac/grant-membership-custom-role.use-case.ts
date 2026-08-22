import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import {
  MembershipInactiveError,
  MembershipRequiredError,
} from "../../../../memberships/domain/membership-errors.js";
import type { TenantTransactionPort } from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import { isActiveTenantAuthorizationContext } from "../../../domain/active-tenant-authorization.js";
import type { TenantCustomRoleAssignmentRecord } from "../../../domain/tenant-rbac/tenant-custom-role.js";
import {
  TenantCustomRoleArchivedError,
  TenantCustomRoleNotFoundError,
  TenantRbacAssignmentNotAllowedError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { canMutateTenantRbac } from "../../../domain/tenant-rbac/tenant-rbac-grant-policy.js";

export interface GrantMembershipCustomRoleInput {
  readonly authorization: AuthorizationContext;
  readonly membershipId: string;
  readonly roleId: string;
  readonly requestId: string;
  readonly now: Date;
}

export class GrantMembershipCustomRoleUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(input: GrantMembershipCustomRoleInput): Promise<TenantCustomRoleAssignmentRecord> {
    const authorization = input.authorization;
    if (
      !isActiveTenantAuthorizationContext(authorization) ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantRbacAssignmentGrant) ||
      !canMutateTenantRbac({
        actorSystemRoles: authorization.roleKeys,
        actorPermissionKeys: authorization.permissionKeys,
      })
    ) {
      throw new TenantRbacAssignmentNotAllowedError();
    }

    return this.transactions.run(
      {
        tenantId: authorization.scope.tenantId,
        actorId: authorization.userId,
        sessionId: authorization.sessionId,
        authorization,
        requestId: input.requestId,
        traceId: input.requestId,
        source: "console",
      },
      async (session) => {
        const role = await session.customRoles.lockById(input.roleId);
        if (!role) throw new TenantCustomRoleNotFoundError();
        if (role.archivedAt !== null) throw new TenantCustomRoleArchivedError();

        const membership = await session.memberships.lockById(input.membershipId);
        if (!membership) throw new MembershipRequiredError();
        if (membership.status !== "active") throw new MembershipInactiveError();

        const existing = await session.customRoleAssignments.findActive(
          input.membershipId,
          input.roleId,
        );
        if (existing) return existing;

        const assignment = await session.customRoleAssignments.grant(
          input.membershipId,
          input.roleId,
          input.now,
        );
        await session.memberships.incrementAuthorizationVersion(input.membershipId, input.now);
        await session.audit.append({
          eventType: "tenant.rbac.assignment.granted",
          actorUserId: authorization.userId,
          subjectUserId: membership.userId,
          requestId: input.requestId,
          metadata: {
            assignmentId: assignment.id,
            membershipId: input.membershipId,
            roleId: input.roleId,
          },
          occurredAt: input.now,
        });
        return assignment;
      },
    );
  }
}
