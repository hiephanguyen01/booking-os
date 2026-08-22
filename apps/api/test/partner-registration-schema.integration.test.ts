import assert from "node:assert/strict";
import test, { after } from "node:test";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const TABLE_NAME = "partner_registration_challenges";

after(async () => {
  await prisma.$disconnect();
});

test("Partner registration persistence is tenant-scoped, FORCE RLS, and stores no serialized token", async () => {
  const tables = await prisma.$queryRaw<readonly { table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ${TABLE_NAME}
  `;
  assert.deepEqual(tables.map((row) => row.table_name), [TABLE_NAME]);

  const columns = await prisma.$queryRaw<readonly { column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${TABLE_NAME}
    ORDER BY column_name
  `;
  const columnNames = columns.map((row) => row.column_name);
  assert.ok(columnNames.includes("tenant_id"));
  assert.ok(columnNames.includes("normalized_email"));
  assert.ok(columnNames.includes("selector"));
  assert.ok(columnNames.includes("token_hash"));
  assert.ok(columnNames.includes("completed_partner_id"));
  assert.equal(columnNames.includes("serialized_token"), false);

  const rls = await prisma.$queryRaw<
    readonly { relrowsecurity: boolean; relforcerowsecurity: boolean }[]
  >`
    SELECT c.relrowsecurity, c.relforcerowsecurity
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ${TABLE_NAME}
  `;
  assert.deepEqual(rls, [{ relrowsecurity: true, relforcerowsecurity: true }]);
});

test("Partner registration has one canonical row per tenant/email and a unique selector", async () => {
  const indexes = await prisma.$queryRaw<readonly { indexdef: string }[]>`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = ${TABLE_NAME}
    ORDER BY indexname
  `;
  const normalized = indexes.map((row) => row.indexdef.replaceAll('"', "").replace(/\s+/g, " "));

  assert.ok(
    normalized.some(
      (definition) =>
        definition.includes("UNIQUE") &&
        definition.includes("(tenant_id, normalized_email)"),
    ),
  );
  assert.ok(
    normalized.some(
      (definition) => definition.includes("UNIQUE") && definition.includes("(selector)"),
    ),
  );
});

test("booking_app has exact minimum DML on Partner registration persistence", async () => {
  const privileges = await prisma.$queryRaw<readonly { privilege_type: string }[]>`
    SELECT privilege_type
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND table_name = ${TABLE_NAME}
      AND grantee = 'booking_app'
    ORDER BY privilege_type
  `;

  assert.deepEqual(
    privileges.map((row) => row.privilege_type),
    ["INSERT", "SELECT", "UPDATE"],
  );
});
