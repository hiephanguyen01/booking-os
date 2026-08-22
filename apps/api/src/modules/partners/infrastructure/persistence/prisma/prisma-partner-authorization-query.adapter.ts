import { PERMISSION_KEYS, type PermissionKey, SYSTEM_ROLES } from "@booking-os/auth";
import type { Prisma } from "@prisma/client";

import type {
  PartnerAuthorizationQueryPort,
  PartnerAuthorizationSnapshot,
  PartnerSystemRoleKey,
} from "../../../application/ports/partner-authorization-query.port.js";

const PARTNER_ROLE_KEYS = new Set<PartnerSystemRoleKey>([
  SYSTEM_ROLES.partnerOwner,
  SYSTEM_ROLES.partnerAdmin,
]);
const PARTNER_PERMISSION_KEYS = new Set<PermissionKey>(
  Object.values(PERMISSION_KEYS).filter((key): key is PermissionKey => key.startsWith("partner.")),
);

interface PartnerAuthorizationRow {
  readonly partnerId: string;
  readonly partnerAuthorizationVersion: number;
  readonly partnerMembershipId: string;
  readonly partnerMembershipAuthorizationVersion: number;
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

export class PrismaPartnerAuthorizationQueryAdapter implements PartnerAuthorizationQueryPort {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly tenantId: string,
  ) {}

  async loadForUser(
    partnerId: string,
    userId: string,
  ): Promise<PartnerAuthorizationSnapshot | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly PartnerAuthorizationRow[]>(
      `SELECT
         partner."id" AS "partnerId",
         partner."authorization_version" AS "partnerAuthorizationVersion",
         membership."id" AS "partnerMembershipId",
         membership."authorization_version" AS "partnerMembershipAuthorizationVersion",
         COALESCE(
           array_agg(DISTINCT role_row."key") FILTER (WHERE role_row."key" IS NOT NULL),
           '{}'
         ) AS "roleKeys",
         COALESCE(
           array_agg(DISTINCT permission_row."key")
             FILTER (WHERE permission_row."key" IS NOT NULL),
           '{}'
         ) AS "permissionKeys"
       FROM "partner_memberships" AS membership
       INNER JOIN "partners" AS partner
         ON partner."id" = membership."partner_id"
        AND partner."tenant_id" = membership."tenant_id"
       INNER JOIN "tenant_memberships" AS tenant_membership
         ON tenant_membership."id" = membership."tenant_membership_id"
        AND tenant_membership."tenant_id" = membership."tenant_id"
       LEFT JOIN "partner_system_role_assignments" AS assignment
         ON assignment."partner_membership_id" = membership."id"
        AND assignment."partner_id" = membership."partner_id"
        AND assignment."tenant_id" = membership."tenant_id"
        AND assignment."revoked_at" IS NULL
       LEFT JOIN "roles" AS role_row
         ON role_row."id" = assignment."role_id"
        AND role_row."scope_level" = 'partner'::role_scope_level
        AND role_row."is_system" = true
       LEFT JOIN "role_permissions" AS role_permission
         ON role_permission."role_id" = role_row."id"
       LEFT JOIN "permissions" AS permission_row
         ON permission_row."id" = role_permission."permission_id"
        AND permission_row."scope_level" = 'partner'::role_scope_level
       WHERE membership."tenant_id" = $1::uuid
         AND membership."partner_id" = $2::uuid
         AND tenant_membership."user_id" = $3::uuid
         AND tenant_membership."status" = 'active'::tenant_membership_status
         AND membership."status" = 'active'::partner_membership_status
         AND membership."revoked_at" IS NULL
       GROUP BY
         partner."id",
         partner."authorization_version",
         membership."id",
         membership."authorization_version"`,
      this.tenantId,
      partnerId,
      userId,
    );

    const row = rows[0];
    if (!row || rows.length !== 1) return null;
    const roleKeys = asKnownValues(row.roleKeys, PARTNER_ROLE_KEYS);
    const permissions = asKnownValues(row.permissionKeys, PARTNER_PERMISSION_KEYS);
    if (!roleKeys || !permissions || roleKeys.length === 0) return null;

    return Object.freeze({
      partnerId: row.partnerId,
      partnerAuthorizationVersion: row.partnerAuthorizationVersion,
      partnerMembershipId: row.partnerMembershipId,
      partnerMembershipAuthorizationVersion: row.partnerMembershipAuthorizationVersion,
      roleKeys,
      permissions,
    });
  }
}
