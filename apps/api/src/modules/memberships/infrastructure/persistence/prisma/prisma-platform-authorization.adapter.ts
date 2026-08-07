import type { AuthorizationPermissionKey, AuthorizationRoleKey } from "@booking-os/contracts";
import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  PlatformAuthorizationPort,
  PlatformAuthorizationSnapshot,
} from "../../../application/ports/platform-authorization.port.js";

const PLATFORM_DATABASE_ROLE = "booking_platform_app";
const ROLE_KEYS = new Set<AuthorizationRoleKey>(["platform_admin"]);
const PERMISSION_KEYS = new Set<AuthorizationPermissionKey>([
  "platform.security.audit.read",
  "platform.tenants.provision",
  "platform.users.provision",
]);

interface PlatformAuthorizationRow {
  readonly userAuthorizationVersion: number;
  readonly roleKeys: readonly string[];
  readonly permissionKeys: readonly string[];
}

function asKnownValues<Value extends string>(
  values: readonly string[],
  known: ReadonlySet<Value>,
): readonly Value[] | null {
  if (!values.every((value): value is Value => known.has(value as Value))) {
    return null;
  }
  return Object.freeze([...new Set(values)].sort());
}

@Injectable()
export class PrismaPlatformAuthorizationAdapter implements PlatformAuthorizationPort {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async loadActivePlatformAuthorization(
    userId: string,
  ): Promise<PlatformAuthorizationSnapshot | null> {
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
        if (!row || rows.length !== 1) {
          return null;
        }
        const roleKeys = asKnownValues(row.roleKeys, ROLE_KEYS);
        const permissionKeys = asKnownValues(row.permissionKeys, PERMISSION_KEYS);
        if (!roleKeys || !permissionKeys || roleKeys.length === 0) {
          return null;
        }
        return Object.freeze({
          userAuthorizationVersion: row.userAuthorizationVersion,
          roleKeys,
          permissionKeys,
        });
      } finally {
        await transaction.$executeRawUnsafe("SET LOCAL ROLE NONE");
      }
    });
  }
}
