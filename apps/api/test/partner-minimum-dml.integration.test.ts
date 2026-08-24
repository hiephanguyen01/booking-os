import assert from "node:assert/strict";
import test, { after } from "node:test";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

after(async () => {
  await prisma.$disconnect();
});

test("booking_app receives exactly SELECT INSERT UPDATE on Partner authority tables", async () => {
  const expectedTables = ["partner_memberships", "partner_system_role_assignments", "partners"];
  const rows = await prisma.$queryRaw<readonly { table_name: string; privilege_type: string }[]>`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = ANY(${expectedTables}::text[])
      AND grantee = 'booking_app'
    ORDER BY table_name, privilege_type
  `;

  const actual = Object.fromEntries(
    expectedTables.map((tableName) => [
      tableName,
      rows
        .filter((row) => row.table_name === tableName)
        .map((row) => row.privilege_type)
        .sort(),
    ]),
  );

  assert.deepEqual(actual, {
    partner_memberships: ["INSERT", "SELECT", "UPDATE"],
    partner_system_role_assignments: ["INSERT", "SELECT", "UPDATE"],
    partners: ["INSERT", "SELECT", "UPDATE"],
  });
});
