import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import { isActiveTenantAuthorizationContext } from "../../../domain/active-tenant-authorization.js";
import type { TenantCustomRoleRecord } from "../../../domain/tenant-rbac/tenant-custom-role.js";
import { TenantRbacPermissionGrantNotAllowedError } from "../../../domain/tenant-rbac/tenant-rbac.errors.js";

export interface ListTenantCustomRolesInput {
  readonly authorization: AuthorizationContext;
}

export class ListTenantCustomRolesUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(input: ListTenantCustomRolesInput): Promise<readonly TenantCustomRoleRecord[]> {
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
        requestId: authorization.sessionId,
        traceId: authorization.sessionId,
        source: "console",
      },
      (session) => session.customRoles.list(),
    );
  }
}
