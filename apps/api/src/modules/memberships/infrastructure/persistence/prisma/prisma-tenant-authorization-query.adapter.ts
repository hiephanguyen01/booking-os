import {
  type PermissionKey,
  PERMISSION_KEYS,
  type SystemRole,
  SYSTEM_ROLES,
} from "@booking-os/auth";

import type {
  AuthorizationQueryPort,
  TenantAuthorizationSnapshot,
} from "../../../application/ports/authorization-query.port.js";
import type { MembershipPrismaTransaction } from "./prisma-membership-transaction.js";

const ROLE_KEYS = new Set<SystemRole>([SYSTEM_ROLES.tenantOwner, SYSTEM_ROLES.tenantAdmin]);
const PERMISSION_KEY_SET = new Set<PermissionKey>(Object.values(PERMISSION_KEYS));

interface TenantAuthorizationRow {
  readonly tenantSlug: string;
  readonly membershipId: string;
  readonly membershipAuthorizationVersion: number;
  readonly roleKeys: readonly string[];
  readonly permissionKeys: readonly string[];
}

function asKnownValues<Value extends string>(
  values: readonly string[],
  known: ReadonlySet<Value>,
): readonly Value[] | null {
  if (!values.every((value): value is Value => known.has(value as Value))) return null;
  return Object.freeze([...new Set(values)].sort());
}

export class PrismaTenantAuthorizationQueryAdapter implements AuthorizationQueryPort {
  constructor(
    private readonly transaction: MembershipPrismaTransaction,
    private readonly tenantId: string,
  ) {}

  async loadActiveTenantAuthorization(userId: string): Promise<TenantAuthorizationSnapshot | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly TenantAuthorizationRow[]>(
      `SELECT
         tenant."slug" AS "tenantSlug",
         membership."id" AS "membershipId",
         membership."authorization_version" AS "membershipAuthorizationVersion",
         COALESCE(array_agg(DISTINCT role_row."key") FILTER (WHERE role_row."key" IS NOT NULL), '{}') AS "roleKeys",
         COALESCE(array_agg(DISTINCT permission_row."key") FILTER (WHERE permission_row."key" IS NOT NULL), '{}') AS "permissionKeys"
       FROM "tenant_memberships" AS membership
       INNER JOIN "tenants" AS tenant ON tenant."id" = membership."tenant_id"
       LEFT JOIN "role_assignments" AS assignment
         ON assignment."user_id" = membership."user_id"
        AND assignment."tenant_id" = membership."tenant_id"
        AND assignment."scope_level" = 'tenant'::role_scope_level
        AND assignment."revoked_at" IS NULL
       LEFT JOIN "roles" AS role_row ON role_row."id" = assignment."role_id"
       LEFT JOIN "role_permissions" AS role_permission ON role_permission."role_id" = role_row."id"
       LEFT JOIN "permissions" AS permission_row ON permission_row."id" = role_permission."permission_id"
       WHERE membership."tenant_id" = $1::uuid
         AND membership."user_id" = $2::uuid
         AND membership."status" = 'active'::tenant_membership_status
       GROUP BY tenant."slug", membership."id", membership."authorization_version"`,
      this.tenantId,
      userId,
    );
    const row = rows[0];
    if (!row || rows.length !== 1) return null;
    const roleKeys = asKnownValues(row.roleKeys, ROLE_KEYS);
    const permissionKeys = asKnownValues(row.permissionKeys, PERMISSION_KEY_SET);
    if (!roleKeys || !permissionKeys || roleKeys.length === 0) return null;
    return Object.freeze({
      tenantSlug: row.tenantSlug,
      membershipId: row.membershipId,
      membershipStatus: "active",
      membershipAuthorizationVersion: row.membershipAuthorizationVersion,
      roleKeys,
      permissionKeys,
    });
  }
}
