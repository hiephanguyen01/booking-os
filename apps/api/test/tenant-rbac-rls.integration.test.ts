import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const createdTenantIds: string[] = [];

async function runAsTenant<T>(
  tenantId: string | undefined,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
    if (tenantId) {
      await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    }
    return work(transaction);
  });
}

async function createTenant(): Promise<string> {
  const tenantId = randomUUID();
  const slug = `rbac-rls-${tenantId.slice(0, 8)}`;
  await prisma.$executeRaw`
    INSERT INTO "tenants" ("id", "slug", "name", "status")
    VALUES (${tenantId}::uuid, ${slug}, ${slug}, 'active'::tenant_status)
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
  } catch {
    // RED intentionally runs before tenant custom-RBAC persistence exists.
  } finally {
    await prisma.$disconnect();
  }
});

test("all tenant custom RBAC tables use the canonical FORCE-RLS tenant contract", async () => {
  const expectedTables = [
    "tenant_custom_role_assignments",
    "tenant_custom_role_permissions",
    "tenant_custom_roles",
  ];
  const tables = await prisma.$queryRaw<
    readonly { table_name: string; rls_enabled: boolean; rls_forced: boolean }[]
  >`
    SELECT c.relname AS table_name,
           c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(${expectedTables}::text[])
    ORDER BY c.relname
  `;
  assert.deepEqual(tables, [
    { table_name: "tenant_custom_role_assignments", rls_enabled: true, rls_forced: true },
    { table_name: "tenant_custom_role_permissions", rls_enabled: true, rls_forced: true },
    { table_name: "tenant_custom_roles", rls_enabled: true, rls_forced: true },
  ]);

  const policies = await prisma.$queryRaw<
    readonly {
      table_name: string;
      policy_name: string;
      qual: string | null;
      with_check: string | null;
    }[]
  >`
    SELECT tablename AS table_name,
           policyname AS policy_name,
           qual,
           with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(${expectedTables}::text[])
    ORDER BY tablename, policyname
  `;
  assert.deepEqual(
    policies.map(({ table_name, policy_name }) => ({ table_name, policy_name })),
    [
      {
        table_name: "tenant_custom_role_assignments",
        policy_name: "tenant_custom_role_assignments_tenant_isolation",
      },
      {
        table_name: "tenant_custom_role_permissions",
        policy_name: "tenant_custom_role_permissions_tenant_isolation",
      },
      {
        table_name: "tenant_custom_roles",
        policy_name: "tenant_custom_roles_tenant_isolation",
      },
    ],
  );
  for (const policy of policies) {
    assert.match(policy.qual ?? "", /app\.tenant_id/);
    assert.match(policy.with_check ?? "", /app\.tenant_id/);
    assert.doesNotMatch(policy.qual ?? "", /app\.current_tenant_id/);
    assert.doesNotMatch(policy.with_check ?? "", /app\.current_tenant_id/);
  }

  const grants = await prisma.$queryRaw<
    readonly { table_name: string; privilege_type: string }[]
  >`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = ANY(${expectedTables}::text[])
      AND grantee = 'booking_app'
    ORDER BY table_name, privilege_type
  `;
  for (const table of expectedTables) {
    assert.deepEqual(
      grants
        .filter((grant) => grant.table_name === table)
        .map((grant) => grant.privilege_type)
        .sort(),
      ["DELETE", "INSERT", "SELECT", "UPDATE"],
    );
  }
});

test("missing and foreign tenant context cannot read or mutate tenant custom RBAC rows", async () => {
  const tenantAId = await createTenant();
  const tenantBId = await createTenant();
  const roleId = randomUUID();

  await runAsTenant(
    tenantAId,
    (transaction) => transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES (
        ${roleId}::uuid, ${tenantAId}::uuid, 'Dispatcher', 'dispatcher', 1,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `,
  );

  const visibleA = await runAsTenant(
    tenantAId,
    (transaction) => transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "tenant_custom_roles" WHERE "id" = ${roleId}::uuid
    `,
  );
  assert.deepEqual(visibleA, [{ id: roleId }]);

  const visibleB = await runAsTenant(
    tenantBId,
    (transaction) => transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "tenant_custom_roles" WHERE "id" = ${roleId}::uuid
    `,
  );
  assert.deepEqual(visibleB, []);

  const missing = await runAsTenant(
    undefined,
    (transaction) => transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "tenant_custom_roles" WHERE "id" = ${roleId}::uuid
    `,
  );
  assert.deepEqual(missing, []);

  const crossTenantUpdate = await runAsTenant(
    tenantBId,
    (transaction) => transaction.$executeRaw`
      UPDATE "tenant_custom_roles"
      SET "name" = 'Compromised', "updated_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${roleId}::uuid
    `,
  );
  assert.equal(crossTenantUpdate, 0);

  await assert.rejects(
    runAsTenant(
      tenantBId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_custom_roles" (
          "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
        ) VALUES (
          ${randomUUID()}::uuid, ${tenantAId}::uuid, 'Cross Tenant', 'cross tenant', 1,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `,
    ),
  );

  const crossTenantDelete = await runAsTenant(
    tenantBId,
    (transaction) => transaction.$executeRaw`
      DELETE FROM "tenant_custom_roles" WHERE "id" = ${roleId}::uuid
    `,
  );
  assert.equal(crossTenantDelete, 0);
});
