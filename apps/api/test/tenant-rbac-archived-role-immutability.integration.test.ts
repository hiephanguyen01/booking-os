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

async function createArchivedRoleWithPermission(
  roleName: string,
): Promise<{ tenantId: string; roleId: string; permissionId: string }> {
  const tenantId = await createTenant();
  const roleId = randomUUID();
  const tenantPermission = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "permissions" WHERE "key" = 'tenant.membership.read'
  `;
  const permissionId = tenantPermission[0]?.id;
  assert.ok(permissionId);

  await runAsTenant(tenantId, async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES (
        ${roleId}::uuid,
        ${tenantId}::uuid,
        ${roleName},
        ${roleName.toLowerCase()},
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_role_permissions" (
        "tenant_id", "role_id", "permission_id", "created_at"
      ) VALUES (
        ${tenantId}::uuid,
        ${roleId}::uuid,
        ${permissionId}::uuid,
        CURRENT_TIMESTAMP
      )
    `;
    await transaction.$executeRaw`
      UPDATE "tenant_custom_roles"
      SET "archived_at" = CURRENT_TIMESTAMP,
          "version" = "version" + 1,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${roleId}::uuid
    `;
  });

  return { tenantId, roleId, permissionId };
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

test("archived tenant custom role rows reject booking_app UPDATE", async () => {
  const { tenantId, roleId } = await createArchivedRoleWithPermission("Archived Role Update");

  const updateResult = await Promise.allSettled([
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        UPDATE "tenant_custom_roles"
        SET "archived_at" = NULL,
            "name" = 'Reactivated Role',
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${roleId}::uuid
      `,
    ),
  ]);

  const roleState = await runAsTenant(
    tenantId,
    (transaction) => transaction.$queryRaw<readonly { archived_at: Date | null; name: string }[]>`
      SELECT "archived_at", "name"
      FROM "tenant_custom_roles"
      WHERE "id" = ${roleId}::uuid
    `,
  );

  assert.equal(updateResult[0]?.status, "rejected", "archived role UPDATE must be rejected");
  assert.equal(roleState.length, 1);
  assert.ok(roleState[0]?.archived_at instanceof Date);
  assert.equal(roleState[0]?.name, "Archived Role Update");
});

test("archived tenant custom role permission mappings reject booking_app DELETE", async () => {
  const { tenantId, roleId, permissionId } =
    await createArchivedRoleWithPermission("Archived Mapping Delete");

  const deleteResult = await Promise.allSettled([
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        DELETE FROM "tenant_custom_role_permissions"
        WHERE "role_id" = ${roleId}::uuid
          AND "permission_id" = ${permissionId}::uuid
      `,
    ),
  ]);

  const mappingState = await runAsTenant(
    tenantId,
    (transaction) => transaction.$queryRaw<readonly { role_id: string }[]>`
      SELECT "role_id"
      FROM "tenant_custom_role_permissions"
      WHERE "role_id" = ${roleId}::uuid
        AND "permission_id" = ${permissionId}::uuid
    `,
  );

  assert.equal(
    deleteResult[0]?.status,
    "rejected",
    "archived role permission DELETE must be rejected",
  );
  assert.deepEqual(mappingState, [{ role_id: roleId }]);
});
