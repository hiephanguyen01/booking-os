import assert from "node:assert/strict";
import test, { after } from "node:test";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

after(async () => {
  await prisma.$disconnect();
});

test("booking_app receives only the minimum DML required by tenant custom RBAC", async () => {
  const rows = await prisma.$queryRaw<
    readonly { table_name: string; privilege_type: string }[]
  >`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name IN (
        'tenant_custom_roles',
        'tenant_custom_role_permissions',
        'tenant_custom_role_assignments'
      )
      AND grantee = 'booking_app'
    ORDER BY table_name, privilege_type
  `;

  const actual = Object.fromEntries(
    [
      "tenant_custom_roles",
      "tenant_custom_role_permissions",
      "tenant_custom_role_assignments",
    ].map((tableName) => [
      tableName,
      rows
        .filter((row) => row.table_name === tableName)
        .map((row) => row.privilege_type)
        .sort(),
    ]),
  );

  assert.deepEqual(actual, {
    tenant_custom_roles: ["INSERT", "SELECT", "UPDATE"],
    tenant_custom_role_permissions: ["DELETE", "INSERT", "SELECT"],
    tenant_custom_role_assignments: ["INSERT", "SELECT", "UPDATE"],
  });
});
