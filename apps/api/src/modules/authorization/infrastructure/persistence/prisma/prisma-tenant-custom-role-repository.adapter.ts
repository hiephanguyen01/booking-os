import type { PermissionKey } from "@booking-os/auth";
import type { Prisma } from "@prisma/client";
import type { TenantCustomRoleRepositoryPort } from "../../../application/ports/tenant-custom-role-repository.port.js";
import type {
  CreateTenantCustomRoleRecordInput,
  TenantCustomRoleRecord,
  UpdateTenantCustomRoleMetadataRecordInput,
} from "../../../domain/tenant-rbac/tenant-custom-role.js";
import {
  TenantCustomRoleNameConflictError,
  TenantCustomRoleNotFoundError,
  TenantCustomRoleVersionConflictError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";

interface TenantCustomRoleRow {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly normalizedName: string;
  readonly description: string | null;
  readonly version: number;
  readonly archivedAt: Date | null;
}

interface PermissionKeyRow {
  readonly key: PermissionKey;
}

const ROLE_COLUMNS = `
  "id",
  "tenant_id" AS "tenantId",
  "name",
  "normalized_name" AS "normalizedName",
  "description",
  "version",
  "archived_at" AS "archivedAt"
`;

function stablePermissionKeys(keys: readonly PermissionKey[]): readonly PermissionKey[] {
  return Object.freeze([...keys].sort());
}

function mapRole(
  row: TenantCustomRoleRow,
  permissionKeys: readonly PermissionKey[],
): TenantCustomRoleRecord {
  return Object.freeze({
    ...row,
    permissionKeys: stablePermissionKeys(permissionKeys),
  });
}

function postgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("meta" in error)) return null;
  const meta = (error as { readonly meta?: unknown }).meta;
  if (!meta || typeof meta !== "object" || !("code" in meta)) return null;
  const code = (meta as { readonly code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export class PrismaTenantCustomRoleRepositoryAdapter implements TenantCustomRoleRepositoryPort {
  constructor(
    private readonly transaction: Prisma.TransactionClient,
    private readonly tenantId: string,
  ) {}

  async list(): Promise<readonly TenantCustomRoleRecord[]> {
    const rows = await this.transaction.$queryRawUnsafe<readonly TenantCustomRoleRow[]>(
      `SELECT ${ROLE_COLUMNS}
       FROM "tenant_custom_roles"
       WHERE "tenant_id" = $1::uuid
       ORDER BY "normalized_name", "id"`,
      this.tenantId,
    );
    return Object.freeze(await Promise.all(rows.map((row) => this.mapRoleWithPermissions(row))));
  }

  async findById(id: string): Promise<TenantCustomRoleRecord | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly TenantCustomRoleRow[]>(
      `SELECT ${ROLE_COLUMNS}
       FROM "tenant_custom_roles"
       WHERE "tenant_id" = $1::uuid AND "id" = $2::uuid`,
      this.tenantId,
      id,
    );
    const row = rows[0];
    return row ? this.mapRoleWithPermissions(row) : null;
  }

  async lockById(id: string): Promise<TenantCustomRoleRecord | null> {
    const rows = await this.transaction.$queryRawUnsafe<readonly TenantCustomRoleRow[]>(
      `SELECT ${ROLE_COLUMNS}
       FROM "tenant_custom_roles"
       WHERE "tenant_id" = $1::uuid AND "id" = $2::uuid
       FOR UPDATE`,
      this.tenantId,
      id,
    );
    const row = rows[0];
    return row ? this.mapRoleWithPermissions(row) : null;
  }

  async create(input: CreateTenantCustomRoleRecordInput): Promise<TenantCustomRoleRecord> {
    try {
      const rows = await this.transaction.$queryRawUnsafe<readonly TenantCustomRoleRow[]>(
        `INSERT INTO "tenant_custom_roles" (
           "tenant_id", "name", "normalized_name", "description", "version",
           "created_at", "updated_at"
         )
         VALUES ($1::uuid, $2, $3, $4, 1, $5::timestamptz, $5::timestamptz)
         RETURNING ${ROLE_COLUMNS}`,
        this.tenantId,
        input.name,
        input.normalizedName,
        input.description,
        input.now,
      );
      const row = rows[0];
      if (!row) throw new TenantCustomRoleNotFoundError();
      return mapRole(row, []);
    } catch (error) {
      if (postgresErrorCode(error) === "23505") {
        throw new TenantCustomRoleNameConflictError();
      }
      throw error;
    }
  }

  async updateMetadata(
    input: UpdateTenantCustomRoleMetadataRecordInput,
  ): Promise<TenantCustomRoleRecord> {
    try {
      const rows = await this.transaction.$queryRawUnsafe<readonly TenantCustomRoleRow[]>(
        `UPDATE "tenant_custom_roles"
         SET "name" = $4,
             "normalized_name" = $5,
             "description" = $6,
             "version" = "version" + 1,
             "updated_at" = $7::timestamptz
         WHERE "tenant_id" = $1::uuid
           AND "id" = $2::uuid
           AND "version" = $3
           AND "archived_at" IS NULL
         RETURNING ${ROLE_COLUMNS}`,
        this.tenantId,
        input.id,
        input.expectedVersion,
        input.name,
        input.normalizedName,
        input.description,
        input.now,
      );
      const row = rows[0];
      if (!row) throw new TenantCustomRoleVersionConflictError();
      return this.mapRoleWithPermissions(row);
    } catch (error) {
      if (postgresErrorCode(error) === "23505") {
        throw new TenantCustomRoleNameConflictError();
      }
      throw error;
    }
  }

  async replacePermissions(roleId: string, permissionIds: readonly string[]): Promise<void> {
    await this.transaction.$executeRawUnsafe(
      `DELETE FROM "tenant_custom_role_permissions"
       WHERE "tenant_id" = $1::uuid AND "role_id" = $2::uuid`,
      this.tenantId,
      roleId,
    );
    if (permissionIds.length === 0) return;

    const values = permissionIds
      .map((_, index) => `($1::uuid, $2::uuid, $${index + 3}::uuid, CURRENT_TIMESTAMP)`)
      .join(", ");
    await this.transaction.$executeRawUnsafe(
      `INSERT INTO "tenant_custom_role_permissions" (
         "tenant_id", "role_id", "permission_id", "created_at"
       ) VALUES ${values}`,
      this.tenantId,
      roleId,
      ...permissionIds,
    );
  }

  async archive(roleId: string, now: Date): Promise<TenantCustomRoleRecord> {
    const rows = await this.transaction.$queryRawUnsafe<readonly TenantCustomRoleRow[]>(
      `UPDATE "tenant_custom_roles"
       SET "archived_at" = $3::timestamptz,
           "version" = "version" + 1,
           "updated_at" = $3::timestamptz
       WHERE "tenant_id" = $1::uuid
         AND "id" = $2::uuid
         AND "archived_at" IS NULL
       RETURNING ${ROLE_COLUMNS}`,
      this.tenantId,
      roleId,
      now,
    );
    const row = rows[0];
    if (!row) throw new TenantCustomRoleNotFoundError();
    return this.mapRoleWithPermissions(row);
  }

  async listActiveHolderMembershipIds(roleId: string): Promise<readonly string[]> {
    const rows = await this.transaction.$queryRawUnsafe<readonly { membershipId: string }[]>(
      `SELECT assignment."membership_id" AS "membershipId"
       FROM "tenant_custom_role_assignments" AS assignment
       INNER JOIN "tenant_memberships" AS membership
         ON membership."id" = assignment."membership_id"
        AND membership."tenant_id" = assignment."tenant_id"
       WHERE assignment."tenant_id" = $1::uuid
         AND assignment."role_id" = $2::uuid
         AND assignment."revoked_at" IS NULL
         AND membership."status" = 'active'::tenant_membership_status
       ORDER BY assignment."membership_id"`,
      this.tenantId,
      roleId,
    );
    return Object.freeze(rows.map((row) => row.membershipId));
  }

  private async mapRoleWithPermissions(row: TenantCustomRoleRow): Promise<TenantCustomRoleRecord> {
    const permissions = await this.transaction.$queryRawUnsafe<readonly PermissionKeyRow[]>(
      `SELECT permission."key"::text AS "key"
       FROM "tenant_custom_role_permissions" AS mapping
       INNER JOIN "permissions" AS permission ON permission."id" = mapping."permission_id"
       WHERE mapping."tenant_id" = $1::uuid AND mapping."role_id" = $2::uuid
       ORDER BY permission."key"`,
      this.tenantId,
      row.id,
    );
    return mapRole(
      row,
      permissions.map((permission) => permission.key),
    );
  }
}
