import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import { isActiveTenantAuthorizationContext } from "../../../domain/active-tenant-authorization.js";
import type { TenantCustomRoleRecord } from "../../../domain/tenant-rbac/tenant-custom-role.js";
import {
  TenantCustomRoleArchivedError,
  TenantCustomRoleNotFoundError,
  TenantCustomRoleVersionConflictError,
  TenantRbacPermissionGrantNotAllowedError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { canMutateTenantRbac } from "../../../domain/tenant-rbac/tenant-rbac-grant-policy.js";

export interface ArchiveTenantCustomRoleInput {
  readonly authorization: AuthorizationContext;
  readonly roleId: string;
  readonly expectedVersion: number;
  readonly requestId: string | null;
  readonly now: Date;
}

export class ArchiveTenantCustomRoleUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(input: ArchiveTenantCustomRoleInput): Promise<TenantCustomRoleRecord> {
    const authorization = input.authorization;
    if (
      !isActiveTenantAuthorizationContext(authorization) ||
      !authorization.permissionKeys.includes(PERMISSION_KEYS.tenantRbacRoleArchive) ||
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

        const archived = await session.customRoles.archive(current.id, input.now);
        const affectedMembershipIds = [
          ...new Set(await session.customRoleAssignments.revokeAllForRole(current.id, input.now)),
        ].sort();
        let invalidatedMembershipCount = 0;
        for (const membershipId of affectedMembershipIds) {
          const membership = await session.memberships.lockById(membershipId);
          if (membership?.status === "active") {
            await session.memberships.incrementAuthorizationVersion(membershipId, input.now);
            invalidatedMembershipCount += 1;
          }
        }

        await session.audit.append({
          eventType: "tenant.rbac.role.archived",
          actorUserId: authorization.userId,
          subjectUserId: null,
          requestId: input.requestId,
          metadata: {
            roleId: current.id,
            previousRoleVersion: current.version,
            roleVersion: archived.version,
            revokedAssignmentCount: affectedMembershipIds.length,
            invalidatedMembershipCount,
          },
          occurredAt: input.now,
        });

        return archived;
      },
    );
  }
}
