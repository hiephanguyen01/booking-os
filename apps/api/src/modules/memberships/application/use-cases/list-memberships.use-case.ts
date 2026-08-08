import { PERMISSION_KEYS, type SystemRole } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../tenancy/application/ports/tenant-transaction.port.js";
import { RoleGrantNotAllowedError } from "../../domain/membership-errors.js";
import type { TenantMembershipStatus } from "../../domain/tenant-membership.js";

export interface ListMembershipsCommand {
  readonly authorization: AuthorizationContext;
  readonly requestId: string;
}

export interface ListedTenantMembership {
  readonly id: string;
  readonly userId: string;
  readonly status: TenantMembershipStatus;
  readonly authorizationVersion: number;
  readonly roleKeys: readonly SystemRole[];
}

export class ListMembershipsUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(command: ListMembershipsCommand): Promise<readonly ListedTenantMembership[]> {
    const authorization = command.authorization;
    if (
      authorization.scope.type !== "tenant" ||
      authorization.membershipStatus !== "active" ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantMembershipRead)
    ) {
      throw new RoleGrantNotAllowedError();
    }

    return this.transactions.run(
      {
        tenantId: authorization.scope.tenantId,
        actorId: authorization.userId,
        requestId: command.requestId,
        traceId: command.requestId,
        source: "console",
      },
      async (session) => {
        const memberships = await session.memberships.list();
        return Promise.all(
          memberships.map(async (membership) => ({
            id: membership.id,
            userId: membership.userId,
            status: membership.status,
            authorizationVersion: membership.authorizationVersion,
            roleKeys: await session.roles.listActiveRoleKeys(membership.userId),
          })),
        );
      },
    );
  }
}
