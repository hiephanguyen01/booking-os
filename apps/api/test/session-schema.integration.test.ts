import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

async function createUser(): Promise<string> {
  const userId = randomUUID();
  const email = `${userId}@example.test`;

  await prisma.$executeRaw`
    INSERT INTO "users" (
      "id",
      "normalized_email",
      "display_email",
      "status",
      "authorization_version",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${userId}::uuid,
      ${email},
      ${email},
      'active',
      1,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;
  createdUserIds.push(userId);
  return userId;
}

async function createTenant(): Promise<string> {
  const tenantId = randomUUID();
  const slug = `session-${tenantId.slice(0, 8)}`;

  await prisma.$executeRaw`
    INSERT INTO "tenants" ("id", "slug", "name")
    VALUES (${tenantId}::uuid, ${slug}, ${slug})
  `;
  createdTenantIds.push(tenantId);
  return tenantId;
}

async function runAsRole<T>(
  role: "booking_app" | "booking_platform_app",
  tenantId: string | undefined,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
    if (tenantId) {
      await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    }
    return work(transaction);
  });
}

interface SessionInput {
  readonly userId: string;
  readonly scopeType: "platform" | "tenant";
  readonly tenantId?: string;
  readonly role: "booking_app" | "booking_platform_app";
  readonly idleHours?: number;
  readonly absoluteHours?: number;
}

async function insertSession(input: SessionInput): Promise<string> {
  const id = randomUUID();
  const hostname = `${input.scopeType}-${id.slice(0, 8)}.example.test`;
  const idleHours = input.idleHours ?? 24;
  const absoluteHours = input.absoluteHours ?? 48;

  await runAsRole(
    input.role,
    input.tenantId,
    (transaction) =>
      transaction.$executeRaw`
      INSERT INTO "auth_sessions" (
        "id",
        "user_id",
        "scope_type",
        "tenant_id",
        "hostname",
        "state",
        "authorization_version",
        "version",
        "idle_expires_at",
        "absolute_expires_at",
        "last_seen_at",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${id}::uuid,
        ${input.userId}::uuid,
        ${input.scopeType}::identity_scope_type,
        ${input.tenantId ?? null}::uuid,
        ${hostname},
        'active'::auth_session_state,
        1,
        1,
        CURRENT_TIMESTAMP + (${idleHours} * INTERVAL '1 hour'),
        CURRENT_TIMESTAMP + (${absoluteHours} * INTERVAL '1 hour'),
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
  );

  return id;
}

async function insertToken(
  sessionId: string,
  tenantId: string,
  selector = randomUUID(),
): Promise<string> {
  const tokenId = randomUUID();

  await runAsRole(
    "booking_app",
    tenantId,
    (transaction) =>
      transaction.$executeRaw`
      INSERT INTO "auth_session_tokens" (
        "id",
        "session_id",
        "scope_type",
        "tenant_id",
        "selector",
        "token_hash",
        "issued_at",
        "expires_at"
      )
      VALUES (
        ${tokenId}::uuid,
        ${sessionId}::uuid,
        'tenant'::identity_scope_type,
        ${tenantId}::uuid,
        ${selector},
        ${"a".repeat(64)},
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP + INTERVAL '48 hours'
      )
    `,
  );

  return tokenId;
}

after(async () => {
  try {
    for (const tenantId of createdTenantIds) {
      await runAsRole("booking_app", tenantId, async (transaction) => {
        await transaction.$executeRaw`
          DELETE FROM "auth_session_tokens"
          WHERE "tenant_id" = ${tenantId}::uuid
        `;
        await transaction.$executeRaw`
          DELETE FROM "auth_sessions"
          WHERE "tenant_id" = ${tenantId}::uuid
        `;
      });
    }

    await runAsRole("booking_platform_app", undefined, async (transaction) => {
      await transaction.$executeRaw`DELETE FROM "auth_session_tokens" WHERE "tenant_id" IS NULL`;
      await transaction.$executeRaw`DELETE FROM "auth_sessions" WHERE "tenant_id" IS NULL`;
    });
  } catch {
    // RED intentionally runs before the session tables and platform role exist.
  }

  try {
    if (createdUserIds.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM "users"
        WHERE "id" = ANY(${createdUserIds}::uuid[])
      `;
    }
    if (createdTenantIds.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM "tenants"
        WHERE "id" = ANY(${createdTenantIds}::uuid[])
      `;
    }
  } finally {
    await prisma.$disconnect();
  }
});

test("session migration creates family and token-history tables", async () => {
  const expectedTables = ["auth_session_tokens", "auth_sessions"];
  const rows = await prisma.$queryRaw<readonly { table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${expectedTables}::text[])
    ORDER BY table_name
  `;

  assert.deepEqual(
    rows.map((row) => row.table_name),
    expectedTables,
  );
});

test("session families enforce scope shape and expiry ordering", async () => {
  const userId = await createUser();
  const tenantId = await createTenant();

  await assert.rejects(
    insertSession({
      userId,
      scopeType: "platform",
      tenantId,
      role: "booking_platform_app",
    }),
  );

  await assert.rejects(
    insertSession({
      userId,
      scopeType: "tenant",
      role: "booking_app",
    }),
  );

  await assert.rejects(
    insertSession({
      userId,
      scopeType: "tenant",
      tenantId,
      role: "booking_app",
      idleHours: 72,
      absoluteHours: 48,
    }),
  );

  const sessionId = await insertSession({
    userId,
    scopeType: "tenant",
    tenantId,
    role: "booking_app",
  });
  assert.match(sessionId, /^[0-9a-f-]{36}$/);
});

test("token history enforces selector uniqueness, family scope, and one active token", async () => {
  const userId = await createUser();
  const tenantId = await createTenant();
  const otherTenantId = await createTenant();
  const sessionId = await insertSession({
    userId,
    scopeType: "tenant",
    tenantId,
    role: "booking_app",
  });
  const selector = randomUUID();
  const firstTokenId = await insertToken(sessionId, tenantId, selector);

  await assert.rejects(insertToken(sessionId, tenantId, selector));
  await assert.rejects(insertToken(sessionId, tenantId));

  await assert.rejects(
    runAsRole(
      "booking_app",
      otherTenantId,
      (transaction) =>
        transaction.$executeRaw`
        INSERT INTO "auth_session_tokens" (
          "id",
          "session_id",
          "scope_type",
          "tenant_id",
          "selector",
          "token_hash",
          "issued_at",
          "expires_at"
        )
        VALUES (
          ${randomUUID()}::uuid,
          ${sessionId}::uuid,
          'tenant'::identity_scope_type,
          ${otherTenantId}::uuid,
          ${randomUUID()},
          ${"b".repeat(64)},
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP + INTERVAL '48 hours'
        )
      `,
    ),
  );

  await runAsRole(
    "booking_app",
    tenantId,
    (transaction) =>
      transaction.$executeRaw`
      UPDATE "auth_session_tokens"
      SET "replaced_at" = CURRENT_TIMESTAMP,
          "overlap_until" = CURRENT_TIMESTAMP + INTERVAL '30 seconds'
      WHERE "id" = ${firstTokenId}::uuid
    `,
  );

  const successorId = await insertToken(sessionId, tenantId);
  assert.match(successorId, /^[0-9a-f-]{36}$/);
});

test("session persistence stores digests but no raw browser secrets", async () => {
  const rows = await prisma.$queryRaw<readonly { table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('auth_sessions', 'auth_session_tokens')
    ORDER BY table_name, ordinal_position
  `;
  const columnsByTable = new Map<string, string[]>();
  for (const row of rows) {
    const columns = columnsByTable.get(row.table_name) ?? [];
    columns.push(row.column_name);
    columnsByTable.set(row.table_name, columns);
  }

  const sessionColumns = columnsByTable.get("auth_sessions") ?? [];
  const tokenColumns = columnsByTable.get("auth_session_tokens") ?? [];

  assert.equal(tokenColumns.includes("token_hash"), true);
  for (const forbidden of ["token", "secret", "raw_token", "access_token", "refresh_token"]) {
    assert.equal(tokenColumns.includes(forbidden), false);
    assert.equal(sessionColumns.includes(forbidden), false);
  }
});
