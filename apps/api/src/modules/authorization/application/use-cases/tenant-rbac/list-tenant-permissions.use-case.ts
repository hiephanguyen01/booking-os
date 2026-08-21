import {
  getPermissionCatalogEntry,
  PERMISSION_KEYS,
  type PermissionCatalogEntry,
} from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import { isActiveTenantAuthorizationContext } from "../../../domain/active-tenant-authorization.js";
import { TenantRbacPermissionGrantNotAllowedError } from "../../../domain/tenant-rbac/tenant-rbac.errors.js";

export interface ListTenantPermissionsInput {
  readonly authorization: AuthorizationContext;
}

const TENANT_PERMISSION_CATALOG: readonly PermissionCatalogEntry[] = Object.freeze(
  Object.values(PERMISSION_KEYS)
    .map((key) => getPermissionCatalogEntry(key))
    .filter(
      (entry): entry is PermissionCatalogEntry => entry !== null && entry.scopeLevel === "tenant",
    )
    .sort((left, right) => left.key.localeCompare(right.key)),
);

export class ListTenantPermissionsUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(input: ListTenantPermissionsInput): Promise<readonly PermissionCatalogEntry[]> {
    const authorization = input.authorization;
    if (
      !isActiveTenantAuthorizationContext(authorization) ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantRbacPermissionRead)
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
      async () => TENANT_PERMISSION_CATALOG,
    );
  }
}
