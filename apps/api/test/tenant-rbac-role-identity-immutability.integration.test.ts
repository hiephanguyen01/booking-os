import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { type Prisma, PrismaClient } from "@prisma/client";

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
  const slug = `rbac-role-identity-${tenantId.slice(0, 8)}`;
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

test("booking_app cannot rewrite the stable tenant custom-role UUID", async () => {
  const tenantId = await createTenant();
  const roleId = randomUUID();
  const replacementRoleId = randomUUID();

  await runAsTenant(
    tenantId,
    (transaction) => transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES (
        ${roleId}::uuid,
        ${tenantId}::uuid,
        'Stable Identity Role',
        'stable identity role',
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
  );

  await assert.rejects(
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        UPDATE "tenant_custom_roles"
        SET "id" = ${replacementRoleId}::uuid,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${roleId}::uuid
      `,
    ),
    /tenant custom role identity cannot be modified/i,
  );

  const rows = await runAsTenant(
    tenantId,
    (transaction) => transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id"
      FROM "tenant_custom_roles"
      WHERE "id" IN (${roleId}::uuid, ${replacementRoleId}::uuid)
      ORDER BY "id"
    `,
  );

  assert.deepEqual(rows, [{ id: roleId }]);
});
