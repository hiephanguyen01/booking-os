import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import { MembershipRequiredError } from "../../../../memberships/domain/membership-errors.js";
import type { TenantTransactionPort } from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import { isActiveTenantAuthorizationContext } from "../../../domain/active-tenant-authorization.js";
import type { TenantCustomRoleRecord } from "../../../domain/tenant-rbac/tenant-custom-role.js";
import { TenantRbacAssignmentNotAllowedError } from "../../../domain/tenant-rbac/tenant-rbac.errors.js";

export interface ListMembershipCustomRolesInput {
  readonly authorization: AuthorizationContext;
  readonly membershipId: string;
}

export class ListMembershipCustomRolesUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(input: ListMembershipCustomRolesInput): Promise<readonly TenantCustomRoleRecord[]> {
    const authorization = input.authorization;
    if (
      !isActiveTenantAuthorizationContext(authorization) ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantRbacAssignmentRead)
    ) {
      throw new TenantRbacAssignmentNotAllowedError();
    }

    return this.transactions.run(
      {
        tenantId: authorization.scope.tenantId,
        actorId: authorization.userId,
        sessionId: authorization.sessionId,
        authorization,
        requestId: authorization.sessionId,
        traceId: authorization.sessionId,
        source: "console",
      },
      async (session) => {
        const membership = await session.memberships.findById(input.membershipId);
        if (!membership) throw new MembershipRequiredError();

        const assignments = await session.customRoleAssignments.listActiveForMembership(
          input.membershipId,
        );
        const roles: TenantCustomRoleRecord[] = [];
        for (const assignment of assignments) {
          const role = await session.customRoles.findById(assignment.roleId);
          if (role && role.archivedAt === null) roles.push(role);
        }
        return Object.freeze(roles);
      },
    );
  }
}
