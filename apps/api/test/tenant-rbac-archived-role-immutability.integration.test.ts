import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const createdTenantIds: string[] = [];

async function runAsTenant<T>(
  tenantId: string,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
    await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return work(transaction);
  });
}

async function createTenant(): Promise<string> {
  const tenantId = randomUUID();
  const slug = `rbac-archive-immutable-${tenantId.slice(0, 8)}`;
  await prisma.$executeRaw`
    INSERT INTO "tenants" ("id", "slug", "name", "status")
    VALUES (${tenantId}::uuid, ${slug}, ${slug}, 'provisioning'::tenant_status)
  `;
  createdTenantIds.push(tenantId);
  return tenantId;
}

after(async () => {
  try {
    if (createdTenantIds.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM "tenants" WHERE "id" = ANY(${createdTenantIds}::uuid[])
      `;
    }
  } finally {
    await prisma.$disconnect();
  }
});

test("archived tenant custom roles are immutable through booking_app DML", async () => {
  const tenantId = await createTenant();
  const roleUpdateId = randomUUID();
  const mappingDeleteRoleId = randomUUID();
  const tenantPermission = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "permissions" WHERE "key" = 'tenant.membership.read'
  `;
  const permissionId = tenantPermission[0]?.id;
  assert.ok(permissionId);

  await runAsTenant(tenantId, async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES
        (
          ${roleUpdateId}::uuid, ${tenantId}::uuid, 'Archived Role Update',
          'archived role update', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ),
        (
          ${mappingDeleteRoleId}::uuid, ${tenantId}::uuid, 'Archived Mapping Delete',
          'archived mapping delete', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
    `;
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_role_permissions" (
        "tenant_id", "role_id", "permission_id", "created_at"
      ) VALUES
        (${tenantId}::uuid, ${roleUpdateId}::uuid, ${permissionId}::uuid, CURRENT_TIMESTAMP),
        (${tenantId}::uuid, ${mappingDeleteRoleId}::uuid, ${permissionId}::uuid, CURRENT_TIMESTAMP)
    `;
    await transaction.$executeRaw`
      UPDATE "tenant_custom_roles"
      SET "archived_at" = CURRENT_TIMESTAMP,
          "version" = "version" + 1,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" IN (${roleUpdateId}::uuid, ${mappingDeleteRoleId}::uuid)
    `;
  });

  const [roleUpdateResult, mappingDeleteResult] = await Promise.allSettled([
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        UPDATE "tenant_custom_roles"
        SET "archived_at" = NULL,
            "name" = 'Reactivated Role',
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${roleUpdateId}::uuid
      `,
    ),
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        DELETE FROM "tenant_custom_role_permissions"
        WHERE "role_id" = ${mappingDeleteRoleId}::uuid
          AND "permission_id" = ${permissionId}::uuid
      `,
    ),
  ]);

  assert.deepEqual(
    [roleUpdateResult.status, mappingDeleteResult.status],
    ["rejected", "rejected"],
    "archived role rows and permission mappings must reject direct mutation",
  );

  const state = await runAsTenant(tenantId, async (transaction) => ({
    roles: await transaction.$queryRaw<readonly { id: string; archived_at: Date | null }[]>`
      SELECT "id", "archived_at"
      FROM "tenant_custom_roles"
      WHERE "id" IN (${roleUpdateId}::uuid, ${mappingDeleteRoleId}::uuid)
      ORDER BY "id"
    `,
    mappings: await transaction.$queryRaw<readonly { role_id: string }[]>`
      SELECT "role_id"
      FROM "tenant_custom_role_permissions"
      WHERE "role_id" IN (${roleUpdateId}::uuid, ${mappingDeleteRoleId}::uuid)
        AND "permission_id" = ${permissionId}::uuid
      ORDER BY "role_id"
    `,
  }));

  assert.equal(state.roles.length, 2);
  assert.ok(state.roles.every((role) => role.archived_at instanceof Date));
  assert.deepEqual(
    state.mappings.map((mapping) => mapping.role_id).sort(),
    [roleUpdateId, mappingDeleteRoleId].sort(),
  );
});
