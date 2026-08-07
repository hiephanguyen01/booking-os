import type { SystemRole } from "@booking-os/auth";

import type {
  AssignTenantRoleInput,
  RevokeTenantRoleInput,
  TenantRoleAssignmentRepositoryPort,
} from "../../../application/ports/tenant-role-assignment-repository.port.js";
import { RoleGrantNotAllowedError } from "../../../domain/membership-errors.js";
import type { MembershipPrismaTransaction } from "./prisma-membership-transaction.js";

export class PrismaTenantRoleAssignmentRepositoryAdapter
  implements TenantRoleAssignmentRepositoryPort
{
  constructor(
    private readonly transaction: MembershipPrismaTransaction,
    private readonly tenantId: string,
  ) {}

  async listActiveRoleKeys(userId: string): Promise<readonly SystemRole[]> {
    const rows = await this.transaction.$queryRawUnsafe<readonly { roleKey: SystemRole }[]>(
      `SELECT role."key" AS "roleKey"
       FROM "role_assignments" assignment
       INNER JOIN "roles" role ON role."id" = assignment."role_id"
       WHERE assignment."tenant_id" = $1::uuid
         AND assignment."user_id" = $2::uuid
         AND assignment."scope_level" = 'tenant'::role_scope_level
         AND assignment."revoked_at" IS NULL
       ORDER BY role."key"`,
      this.tenantId,
      userId,
    );
    return Object.freeze(rows.map((row) => row.roleKey));
  }

  async lockActiveOwnerUserIds(): Promise<readonly string[]> {
    const rows = await this.transaction.$queryRawUnsafe<readonly { userId: string }[]>(
      `SELECT assignment."user_id" AS "userId"
       FROM "role_assignments" assignment
       INNER JOIN "roles" role ON role."id" = assignment."role_id"
       INNER JOIN "tenant_memberships" membership
         ON membership."tenant_id" = assignment."tenant_id"
        AND membership."user_id" = assignment."user_id"
       WHERE assignment."tenant_id" = $1::uuid
         AND assignment."scope_level" = 'tenant'::role_scope_level
         AND assignment."revoked_at" IS NULL
         AND membership."status" = 'active'::tenant_membership_status
         AND role."key" = 'tenant_owner'
       ORDER BY assignment."user_id"
       FOR UPDATE OF assignment, membership`,
      this.tenantId,
    );
    return Object.freeze(rows.map((row) => row.userId));
  }

  async assign(input: AssignTenantRoleInput): Promise<void> {
    const affected = await this.transaction.$executeRawUnsafe(
      `INSERT INTO "role_assignments" (
         "id", "user_id", "role_id", "scope_level", "tenant_id", "created_at"
       )
       SELECT gen_random_uuid(), $2::uuid, role."id",
              'tenant'::role_scope_level, $1::uuid, $4::timestamptz
       FROM "roles" role
       WHERE role."key" = $3
         AND role."scope_level" = 'tenant'::role_scope_level`,
      this.tenantId,
      input.userId,
      input.roleKey,
      input.now,
    );
    if (affected !== 1) {
      throw new RoleGrantNotAllowedError();
    }
  }

  async revoke(input: RevokeTenantRoleInput): Promise<void> {
    const affected = await this.transaction.$executeRawUnsafe(
      `UPDATE "role_assignments" assignment
       SET "revoked_at" = $4::timestamptz
       FROM "roles" role
       WHERE assignment."tenant_id" = $1::uuid
         AND assignment."user_id" = $2::uuid
         AND assignment."role_id" = role."id"
         AND role."key" = $3
         AND assignment."scope_level" = 'tenant'::role_scope_level
         AND assignment."revoked_at" IS NULL`,
      this.tenantId,
      input.userId,
      input.roleKey,
      input.now,
    );
    if (affected !== 1) {
      throw new RoleGrantNotAllowedError();
    }
  }
}
