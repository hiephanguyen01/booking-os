import { getPermissionCatalogEntry, PERMISSION_KEYS, type PermissionKey } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import { isActiveTenantAuthorizationContext } from "../../../domain/active-tenant-authorization.js";
import type { TenantCustomRoleRecord } from "../../../domain/tenant-rbac/tenant-custom-role.js";
import { normalizeTenantCustomRoleName } from "../../../domain/tenant-rbac/tenant-custom-role-name.js";
import {
  TenantRbacPermissionGrantNotAllowedError,
  TenantRbacPermissionNotDelegableError,
  TenantRbacPermissionScopeInvalidError,
  TenantRbacPermissionUnknownError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import {
  canAddTenantRolePermission,
  canMutateTenantRbac,
} from "../../../domain/tenant-rbac/tenant-rbac-grant-policy.js";

export interface CreateTenantCustomRoleInput {
  readonly authorization: AuthorizationContext;
  readonly name: string;
  readonly description: string | null;
  readonly permissionKeys: readonly PermissionKey[];
  readonly requestId: string;
  readonly now: Date;
}

function validateInitialPermissions(
  authorization: AuthorizationContext,
  keys: readonly PermissionKey[],
): readonly PermissionKey[] {
  const uniqueKeys = [...new Set(keys)].sort();
  for (const key of uniqueKeys) {
    const entry = getPermissionCatalogEntry(key);
    if (!entry) throw new TenantRbacPermissionUnknownError();
    if (entry.scopeLevel !== "tenant") throw new TenantRbacPermissionScopeInvalidError();
    if (!entry.delegable) throw new TenantRbacPermissionNotDelegableError();
    if (
      !canAddTenantRolePermission(
        {
          actorSystemRoles: authorization.roleKeys,
          actorPermissionKeys: authorization.permissionKeys,
        },
        key,
      )
    ) {
      throw new TenantRbacPermissionGrantNotAllowedError();
    }
  }
  return uniqueKeys;
}

export class CreateTenantCustomRoleUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(input: CreateTenantCustomRoleInput): Promise<TenantCustomRoleRecord> {
    const authorization = input.authorization;
    if (
      !isActiveTenantAuthorizationContext(authorization) ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantRbacRoleCreate) ||
      !canMutateTenantRbac({
        actorSystemRoles: authorization.roleKeys,
        actorPermissionKeys: authorization.permissionKeys,
      })
    ) {
      throw new TenantRbacPermissionGrantNotAllowedError();
    }

    const normalized = normalizeTenantCustomRoleName(input.name);
    const permissionKeys = validateInitialPermissions(authorization, input.permissionKeys);

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
        const permissionRows =
          await session.rbacPermissions.findTenantPermissionsByKeys(permissionKeys);
        const permissionIdsByKey = new Map(
          permissionRows.map((permission) => [permission.key, permission.id]),
        );
        const permissionIds = permissionKeys.map((key) => {
          const id = permissionIdsByKey.get(key);
          if (!id) throw new TenantRbacPermissionUnknownError();
          return id;
        });

        const role = await session.customRoles.create({
          name: normalized.name,
          normalizedName: normalized.normalizedName,
          description: input.description,
          now: input.now,
        });
        if (permissionIds.length > 0) {
          await session.customRoles.replacePermissions(role.id, permissionIds);
        }
        await session.audit.append({
          eventType: "tenant.rbac.role.created",
          actorUserId: authorization.userId,
          subjectUserId: null,
          requestId: input.requestId,
          metadata: {
            roleId: role.id,
            roleVersion: role.version,
            permissionKeys,
          },
          occurredAt: input.now,
        });

        return Object.freeze({ ...role, permissionKeys });
      },
    );
  }
}
