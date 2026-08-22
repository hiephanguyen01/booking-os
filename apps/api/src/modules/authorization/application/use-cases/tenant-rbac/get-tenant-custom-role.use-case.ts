import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import { isActiveTenantAuthorizationContext } from "../../../domain/active-tenant-authorization.js";
import type { TenantCustomRoleRecord } from "../../../domain/tenant-rbac/tenant-custom-role.js";
import {
  TenantCustomRoleNotFoundError,
  TenantRbacPermissionGrantNotAllowedError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";

export interface GetTenantCustomRoleInput {
  readonly authorization: AuthorizationContext;
  readonly roleId: string;
}

export class GetTenantCustomRoleUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(input: GetTenantCustomRoleInput): Promise<TenantCustomRoleRecord> {
    const authorization = input.authorization;
    if (
      !isActiveTenantAuthorizationContext(authorization) ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantRbacRoleRead)
    ) {
      throw new TenantRbacPermissionGrantNotAllowedError();
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
        const role = await session.customRoles.findById(input.roleId);
        if (!role) throw new TenantCustomRoleNotFoundError();
        return role;
      },
    );
  }
}
