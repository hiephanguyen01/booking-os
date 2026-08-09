import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../../../../database/prisma.service.js";
import type { TenantTransactionPort } from "../../../../tenancy/application/ports/tenant-transaction.port.js";
import { TENANT_TRANSACTION_PORT } from "../../../../tenancy/tenancy.tokens.js";
import type {
  AuthorizationRepositoryPort,
  CurrentScopeAuthority,
  LoadCurrentScopeAuthorityInput,
} from "../../../application/ports/authorization-repository.port.js";

const PLATFORM_DATABASE_ROLE = "booking_platform_app";

interface PlatformAuthorizationRow {
  readonly userAuthorizationVersion: number;
  readonly roleKeys: readonly string[];
  readonly permissionKeys: readonly string[];
}

@Injectable()
export class PrismaAuthorizationRepositoryAdapter implements AuthorizationRepositoryPort {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TENANT_TRANSACTION_PORT) private readonly tenantTransactions: TenantTransactionPort,
  ) {}

  async loadCurrentScope(
    input: LoadCurrentScopeAuthorityInput,
  ): Promise<CurrentScopeAuthority | null> {
    if (input.scope.type === "platform") {
      return this.loadPlatform(input.userId);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: input.userId, status: "active" },
      select: { authorizationVersion: true },
    });
    if (!user) return null;

    const tenant = await this.tenantTransactions.run(
      { ...input.execution, tenantId: input.scope.tenantId },
      (session) => session.authorization.loadActiveTenantAuthorization(input.userId),
    );
    if (!tenant) return null;

    return Object.freeze({
      scope: Object.freeze({
        type: "tenant" as const,
        tenantId: input.scope.tenantId,
        tenantSlug: tenant.tenantSlug,
      }),
      userAuthorizationVersion: user.authorizationVersion,
      membershipId: tenant.membershipId,
      membershipStatus: tenant.membershipStatus,
      membershipAuthorizationVersion: tenant.membershipAuthorizationVersion,
      roleKeys: tenant.roleKeys,
      permissionKeys: tenant.permissionKeys,
    });
  }

  private async loadPlatform(userId: string): Promise<CurrentScopeAuthority | null> {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${PLATFORM_DATABASE_ROLE}`);
      try {
        const rows = await transaction.$queryRawUnsafe<readonly PlatformAuthorizationRow[]>(
          `SELECT
             user_row."authorization_version" AS "userAuthorizationVersion",
             COALESCE(array_agg(DISTINCT role_row."key") FILTER (WHERE role_row."key" IS NOT NULL), '{}') AS "roleKeys",
             COALESCE(array_agg(DISTINCT permission_row."key") FILTER (WHERE permission_row."key" IS NOT NULL), '{}') AS "permissionKeys"
           FROM "users" AS user_row
           INNER JOIN "role_assignments" AS assignment
             ON assignment."user_id" = user_row."id"
            AND assignment."scope_level" = 'platform'::role_scope_level
            AND assignment."tenant_id" IS NULL
            AND assignment."revoked_at" IS NULL
           INNER JOIN "roles" AS role_row ON role_row."id" = assignment."role_id"
           LEFT JOIN "role_permissions" AS role_permission ON role_permission."role_id" = role_row."id"
           LEFT JOIN "permissions" AS permission_row ON permission_row."id" = role_permission."permission_id"
           WHERE user_row."id" = $1::uuid
             AND user_row."status" = 'active'::user_status
           GROUP BY user_row."authorization_version"`,
          userId,
        );
        const row = rows[0];
        if (!row || rows.length !== 1) return null;
        return Object.freeze({
          scope: Object.freeze({ type: "platform" as const }),
          userAuthorizationVersion: row.userAuthorizationVersion,
          roleKeys: Object.freeze([...row.roleKeys]),
          permissionKeys: Object.freeze([...row.permissionKeys]),
        });
      } finally {
        await transaction.$executeRawUnsafe("SET LOCAL ROLE NONE");
      }
    });
  }
}
