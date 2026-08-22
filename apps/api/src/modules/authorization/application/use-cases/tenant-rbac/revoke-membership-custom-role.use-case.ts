import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import { MembershipRequiredError } from "../../../../memberships/domain/membership-errors.js";
import type { TenantTransactionPort } from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import { isActiveTenantAuthorizationContext } from "../../../domain/active-tenant-authorization.js";
import {
  TenantCustomRoleNotFoundError,
  TenantRbacAssignmentNotAllowedError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { canMutateTenantRbac } from "../../../domain/tenant-rbac/tenant-rbac-grant-policy.js";

export interface RevokeMembershipCustomRoleInput {
  readonly authorization: AuthorizationContext;
  readonly membershipId: string;
  readonly roleId: string;
  readonly requestId: string;
  readonly now: Date;
}

export class RevokeMembershipCustomRoleUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(input: RevokeMembershipCustomRoleInput): Promise<boolean> {
    const authorization = input.authorization;
    if (
      !isActiveTenantAuthorizationContext(authorization) ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantRbacAssignmentRevoke) ||
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

        const membership = await session.memberships.lockById(input.membershipId);
        if (!membership) throw new MembershipRequiredError();

        const changed = await session.customRoleAssignments.revoke(
          input.membershipId,
          input.roleId,
          input.now,
        );
        if (!changed) return false;

        await session.memberships.incrementAuthorizationVersion(input.membershipId, input.now);
        await session.audit.append({
          eventType: "tenant.rbac.assignment.revoked",
          actorUserId: authorization.userId,
          subjectUserId: membership.userId,
          requestId: input.requestId,
          metadata: {
            membershipId: input.membershipId,
            roleId: input.roleId,
          },
          occurredAt: input.now,
        });
        return true;
      },
    );
  }
}
