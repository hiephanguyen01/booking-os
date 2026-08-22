import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import { isActiveTenantAuthorizationContext } from "../../../domain/active-tenant-authorization.js";
import type { TenantCustomRoleRecord } from "../../../domain/tenant-rbac/tenant-custom-role.js";
import { normalizeTenantCustomRoleName } from "../../../domain/tenant-rbac/tenant-custom-role-name.js";
import {
  TenantCustomRoleArchivedError,
  TenantCustomRoleNotFoundError,
  TenantCustomRoleVersionConflictError,
  TenantRbacPermissionGrantNotAllowedError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { canMutateTenantRbac } from "../../../domain/tenant-rbac/tenant-rbac-grant-policy.js";

export interface UpdateTenantCustomRoleInput {
  readonly authorization: AuthorizationContext;
  readonly roleId: string;
  readonly name: string;
  readonly description: string | null;
  readonly expectedVersion: number;
  readonly requestId: string;
  readonly now: Date;
}

export class UpdateTenantCustomRoleUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(input: UpdateTenantCustomRoleInput): Promise<TenantCustomRoleRecord> {
    const authorization = input.authorization;
    if (
      !isActiveTenantAuthorizationContext(authorization) ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantRbacRoleUpdate) ||
      !canMutateTenantRbac({
        actorSystemRoles: authorization.roleKeys,
        actorPermissionKeys: authorization.permissionKeys,
      })
    ) {
      throw new TenantRbacPermissionGrantNotAllowedError();
    }

    const normalized = normalizeTenantCustomRoleName(input.name);

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
        const current = await session.customRoles.lockById(input.roleId);
        if (!current) throw new TenantCustomRoleNotFoundError();
        if (current.archivedAt) throw new TenantCustomRoleArchivedError();
        if (current.version !== input.expectedVersion) {
          throw new TenantCustomRoleVersionConflictError();
        }

        if (
          current.name === normalized.name &&
          current.normalizedName === normalized.normalizedName &&
          current.description === input.description
        ) {
          return current;
        }

        const updated = await session.customRoles.updateMetadata({
          id: current.id,
          name: normalized.name,
          normalizedName: normalized.normalizedName,
          description: input.description,
          expectedVersion: input.expectedVersion,
          now: input.now,
        });
        await session.audit.append({
          eventType: "tenant.rbac.role.updated",
          actorUserId: authorization.userId,
          subjectUserId: null,
          requestId: input.requestId,
          metadata: {
            roleId: updated.id,
            previousVersion: current.version,
            roleVersion: updated.version,
          },
          occurredAt: input.now,
        });

        return updated;
      },
    );
  }
}
