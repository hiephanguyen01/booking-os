import type { Prisma } from "@prisma/client";

import type { TenantCustomRoleAssignmentRepositoryPort } from "../../../application/ports/tenant-custom-role-assignment-repository.port.js";
import type { TenantCustomRoleAssignmentRecord } from "../../../domain/tenant-rbac/tenant-custom-role.js";
import { TenantRbacAssignmentNotFoundError } from "../../../domain/tenant-rbac/tenant-rbac.errors.js";

interface AssignmentRow {
  readonly id: string;
  readonly tenantId: string;
  readonly membershipId: string;
  readonly roleId: string;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
}

const ASSIGNMENT_COLUMNS = `
  "id",
  "tenant_id" AS "tenantId",
  "membership_id" AS "membershipId",
  "role_id" AS "roleId",
  "created_at" AS "createdAt",
  "revoked_at" AS "revokedAt"
`;

function mapAssignment(row: AssignmentRow): TenantCustomRoleAssignmentRecord {
  return Object.freeze({ ...row });
}

function firstAssignment(
  rows: readonly AssignmentRow[],
): TenantCustomRoleAssignmentRecord | null {
  const row = rows[0];
  return row ? mapAssignment(row) : null;
}

export class PrismaTenantCustomRoleAssignmentRepositoryAdapter
  implements TenantCustomRoleAssignmentRepositoryPort
{
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly tenantId: string,
  ) {}

  async listActiveForMembership(
    membershipId: string,
  ): Promise<readonly TenantCustomRoleAssignmentRecord[]> {
    const rows = await this.transaction.$queryRawUnsafe<readonly AssignmentRow[]>(
      `SELECT ${ASSIGNMENT_COLUMNS}
       FROM "tenant_custom_role_assignments"
       WHERE "tenant_id" = $1::uuid
         AND "membership_id" = $2::uuid
         AND "revoked_at" IS NULL
       ORDER BY "role_id", "id"`,
      this.tenantId,
      membershipId,
    );
    return Object.freeze(rows.map(mapAssignment));
  }

  async findActive(
    membershipId: string,
    roleId: string,
  ): Promise<TenantCustomRoleAssignmentRecord | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly AssignmentRow[]>(
      `SELECT ${ASSIGNMENT_COLUMNS}
       FROM "tenant_custom_role_assignments"
       WHERE "tenant_id" = $1::uuid
         AND "membership_id" = $2::uuid
         AND "role_id" = $3::uuid
         AND "revoked_at" IS NULL`,
      this.tenantId,
      membershipId,
      roleId,
    );
    return firstAssignment(rows);
  }

  async grant(
    membershipId: string,
    roleId: string,
    now: Date,
  ): Promise<TenantCustomRoleAssignmentRecord> {
    const rows = await this.transaction.$queryRawUnsafe<readonly AssignmentRow[]>(
      `INSERT INTO "tenant_custom_role_assignments" (
         "id", "tenant_id", "membership_id", "role_id", "created_at"
       ) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::timestamptz)
       RETURNING ${ASSIGNMENT_COLUMNS}`,
      this.tenantId,
      membershipId,
      roleId,
      now,
    );
    const assignment = firstAssignment(rows);
    if (!assignment) throw new TenantRbacAssignmentNotFoundError();
    return assignment;
  }

  async revoke(membershipId: string, roleId: string, now: Date): Promise<boolean> {
    const rows = await this.transaction.$queryRawUnsafe<readonly { id: string }[]>(
      `UPDATE "tenant_custom_role_assignments"
       SET "revoked_at" = $4::timestamptz
       WHERE "tenant_id" = $1::uuid
         AND "membership_id" = $2::uuid
         AND "role_id" = $3::uuid
         AND "revoked_at" IS NULL
       RETURNING "id"`,
      this.tenantId,
      membershipId,
      roleId,
      now,
    );
    return rows.length > 0;
  }

  async revokeAllForRole(roleId: string, now: Date): Promise<readonly string[]> {
    const rows = await this.transaction.$queryRawUnsafe<readonly { membershipId: string }[]>(
      `UPDATE "tenant_custom_role_assignments"
       SET "revoked_at" = $3::timestamptz
       WHERE "tenant_id" = $1::uuid
         AND "role_id" = $2::uuid
         AND "revoked_at" IS NULL
       RETURNING "membership_id" AS "membershipId"`,
      this.tenantId,
      roleId,
      now,
    );
    return Object.freeze([...new Set(rows.map((row) => row.membershipId))].sort());
  }
}
