import { getPermissionCatalogEntry, PERMISSION_KEYS, type PermissionKey } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import { isActiveTenantAuthorizationContext } from "../../../domain/active-tenant-authorization.js";
import type { TenantCustomRoleRecord } from "../../../domain/tenant-rbac/tenant-custom-role.js";
import {
  TenantCustomRoleArchivedError,
  TenantCustomRoleNotFoundError,
  TenantCustomRoleVersionConflictError,
  TenantRbacPermissionGrantNotAllowedError,
  TenantRbacPermissionNotDelegableError,
  TenantRbacPermissionScopeInvalidError,
  TenantRbacPermissionUnknownError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import {
  canAddTenantRolePermission,
  canMutateTenantRbac,
} from "../../../domain/tenant-rbac/tenant-rbac-grant-policy.js";

export interface ReplaceTenantCustomRolePermissionsInput {
  readonly authorization: AuthorizationContext;
  readonly roleId: string;
  readonly permissionKeys: readonly PermissionKey[];
  readonly expectedVersion: number;
  readonly requestId: string | null;
  readonly now: Date;
}

function stablePermissionKeys(keys: readonly PermissionKey[]): readonly PermissionKey[] {
  return Object.freeze([...new Set(keys)].sort());
}

function samePermissionKeys(
  left: readonly PermissionKey[],
  right: readonly PermissionKey[],
): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

function validateAddedPermissions(
  authorization: AuthorizationContext,
  addedPermissionKeys: readonly PermissionKey[],
): void {
  for (const key of addedPermissionKeys) {
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
}

export class ReplaceTenantCustomRolePermissionsUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(input: ReplaceTenantCustomRolePermissionsInput): Promise<TenantCustomRoleRecord> {
    const authorization = input.authorization;
    if (
      !isActiveTenantAuthorizationContext(authorization) ||
      !canMutateTenantRbac({
        actorSystemRoles: authorization.roleKeys,
        actorPermissionKeys: authorization.permissionKeys,
      })
    ) {
      throw new TenantRbacPermissionGrantNotAllowedError();
    }

    const requestId = input.requestId ?? input.roleId;

    return this.transactions.run(
      {
        tenantId: authorization.scope.tenantId,
        actorId: authorization.userId,
        sessionId: authorization.sessionId,
        authorization,
        requestId,
        traceId: requestId,
        source: "console",
      },
      async (session) => {
        const current = await session.customRoles.lockById(input.roleId);
        if (!current) throw new TenantCustomRoleNotFoundError();
        if (current.archivedAt) throw new TenantCustomRoleArchivedError();
        if (current.version !== input.expectedVersion) {
          throw new TenantCustomRoleVersionConflictError();
        }

        const currentPermissionKeys = stablePermissionKeys(current.permissionKeys);
        const desiredPermissionKeys = stablePermissionKeys(input.permissionKeys);
        if (samePermissionKeys(currentPermissionKeys, desiredPermissionKeys)) {
          return current;
        }

        const currentSet = new Set(currentPermissionKeys);
        const desiredSet = new Set(desiredPermissionKeys);
        const addedPermissionKeys = desiredPermissionKeys.filter((key) => !currentSet.has(key));
        const removedPermissionKeys = currentPermissionKeys.filter((key) => !desiredSet.has(key));

        if (
          addedPermissionKeys.length > 0 &&
          !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantRbacRolePermissionGrant)
        ) {
          throw new TenantRbacPermissionGrantNotAllowedError();
        }
        if (
          removedPermissionKeys.length > 0 &&
          !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantRbacRolePermissionRevoke)
        ) {
          throw new TenantRbacPermissionGrantNotAllowedError();
        }
        validateAddedPermissions(authorization, addedPermissionKeys);

        let permissionIds: readonly string[] = [];
        if (desiredPermissionKeys.length > 0) {
          const permissionRows =
            await session.rbacPermissions.findTenantPermissionsByKeys(desiredPermissionKeys);
          const idsByKey = new Map(
            permissionRows.map((permission) => [permission.key, permission.id]),
          );
          permissionIds = desiredPermissionKeys.map((key) => {
            const id = idsByKey.get(key);
            if (!id) throw new TenantRbacPermissionUnknownError();
            return id;
          });
        }

        await session.customRoles.replacePermissions(current.id, permissionIds);
        const updated = await session.customRoles.updateMetadata({
          id: current.id,
          name: current.name,
          normalizedName: current.normalizedName,
          description: current.description,
          expectedVersion: current.version,
          now: input.now,
        });
        const result = Object.freeze({ ...updated, permissionKeys: desiredPermissionKeys });

        const membershipIds = [
          ...new Set(await session.customRoles.listActiveHolderMembershipIds(current.id)),
        ].sort();
        for (const membershipId of membershipIds) {
          const membership = await session.memberships.lockById(membershipId);
          if (membership?.status === "active") {
            await session.memberships.incrementAuthorizationVersion(membershipId, input.now);
          }
        }

        await session.audit.append({
          eventType: "tenant.rbac.role.permissions_changed",
          actorUserId: authorization.userId,
          subjectUserId: null,
          requestId: input.requestId,
          metadata: {
            roleId: current.id,
            previousRoleVersion: current.version,
            roleVersion: result.version,
            addedPermissionKeys,
            removedPermissionKeys,
          },
          occurredAt: input.now,
        });

        return result;
      },
    );
  }
}
