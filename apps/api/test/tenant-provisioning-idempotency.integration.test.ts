import assert from "node:assert/strict";
import test, { after } from "node:test";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

after(async () => {
  await prisma.$disconnect();
});

test("tenant provisioning idempotency has a durable replay schema", async () => {
  const tables = await prisma.$queryRaw<readonly { table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'tenant_provisioning_requests'
  `;
  assert.deepEqual(tables, [{ table_name: "tenant_provisioning_requests" }]);

  const columns = await prisma.$queryRaw<
    readonly { column_name: string; is_nullable: "YES" | "NO" }[]
  >`
    SELECT column_name, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tenant_provisioning_requests'
    ORDER BY ordinal_position
  `;
  assert.deepEqual(columns, [
    { column_name: "idempotency_key", is_nullable: "NO" },
    { column_name: "request_hash", is_nullable: "NO" },
    { column_name: "actor_user_id", is_nullable: "NO" },
    { column_name: "status", is_nullable: "NO" },
    { column_name: "tenant_id", is_nullable: "YES" },
    { column_name: "tenant_slug", is_nullable: "YES" },
    { column_name: "owner_membership_id", is_nullable: "YES" },
    { column_name: "owner_invitation_id", is_nullable: "YES" },
    { column_name: "completed_at", is_nullable: "YES" },
    { column_name: "created_at", is_nullable: "NO" },
    { column_name: "updated_at", is_nullable: "NO" },
  ]);

  const statuses = await prisma.$queryRaw<readonly { enumlabel: string }[]>`
    SELECT enumlabel
    FROM pg_enum
    INNER JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'tenant_provisioning_request_status'
    ORDER BY pg_enum.enumsortorder
  `;
  assert.deepEqual(
    statuses.map((row) => row.enumlabel),
    ["in_progress", "completed"],
  );

  const primaryKey = await prisma.$queryRaw<readonly { column_name: string }[]>`
    SELECT attribute.attname AS column_name
    FROM pg_constraint constraint_row
    INNER JOIN pg_class table_row ON table_row.oid = constraint_row.conrelid
    INNER JOIN pg_namespace namespace_row ON namespace_row.oid = table_row.relnamespace
    INNER JOIN unnest(constraint_row.conkey) WITH ORDINALITY AS key_column(attnum, ordinality)
      ON TRUE
    INNER JOIN pg_attribute attribute
      ON attribute.attrelid = table_row.oid
     AND attribute.attnum = key_column.attnum
    WHERE namespace_row.nspname = 'public'
      AND table_row.relname = 'tenant_provisioning_requests'
      AND constraint_row.contype = 'p'
    ORDER BY key_column.ordinality
  `;
  assert.deepEqual(primaryKey, [{ column_name: "idempotency_key" }]);
});
