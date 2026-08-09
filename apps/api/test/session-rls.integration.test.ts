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
  const slug = `session-rls-${tenantId.slice(0, 8)}`;
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

async function insertSession(input: {
  readonly userId: string;
  readonly scopeType: "platform" | "tenant";
  readonly tenantId?: string;
  readonly role: "booking_app" | "booking_platform_app";
}): Promise<string> {
  const sessionId = randomUUID();
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
        ${sessionId}::uuid,
        ${input.userId}::uuid,
        ${input.scopeType}::identity_scope_type,
        ${input.tenantId ?? null}::uuid,
        ${`${input.scopeType}-${sessionId.slice(0, 8)}.example.test`},
        'active'::auth_session_state,
        1,
        1,
        CURRENT_TIMESTAMP + INTERVAL '24 hours',
        CURRENT_TIMESTAMP + INTERVAL '48 hours',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
  );
  return sessionId;
}

async function insertToken(input: {
  readonly sessionId: string;
  readonly scopeType: "platform" | "tenant";
  readonly tenantId?: string;
  readonly role: "booking_app" | "booking_platform_app";
}): Promise<string> {
  const tokenId = randomUUID();
  await runAsRole(
    input.role,
    input.tenantId,
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
        ${input.sessionId}::uuid,
        ${input.scopeType}::identity_scope_type,
        ${input.tenantId ?? null}::uuid,
        ${randomUUID()},
        ${"c".repeat(64)},
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

test("session tables use FORCE RLS with separate tenant and platform policies", async () => {
  const tables = await prisma.$queryRaw<
    readonly { table_name: string; rls_enabled: boolean; rls_forced: boolean }[]
  >`
    SELECT c.relname AS table_name,
           c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('auth_sessions', 'auth_session_tokens')
    ORDER BY c.relname
  `;
  assert.deepEqual(tables, [
    { table_name: "auth_session_tokens", rls_enabled: true, rls_forced: true },
    { table_name: "auth_sessions", rls_enabled: true, rls_forced: true },
  ]);

  const policies = await prisma.$queryRaw<
    readonly { table_name: string; policy_name: string; roles: readonly string[] | string }[]
  >`
    SELECT tablename AS table_name,
           policyname AS policy_name,
           roles
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('auth_sessions', 'auth_session_tokens')
    ORDER BY tablename, policyname
  `;

  const normalized = policies.map((policy) => ({
    table: policy.table_name,
    policy: policy.policy_name,
    roles:
      typeof policy.roles === "string"
        ? policy.roles.replace(/^\{|\}$/g, "").split(",")
        : [...policy.roles],
  }));

  assert.deepEqual(normalized, [
    {
      table: "auth_session_tokens",
      policy: "auth_session_tokens_platform_scope",
      roles: ["booking_platform_app"],
    },
    {
      table: "auth_session_tokens",
      policy: "auth_session_tokens_tenant_isolation",
      roles: ["booking_app"],
    },
    {
      table: "auth_sessions",
      policy: "auth_sessions_platform_scope",
      roles: ["booking_platform_app"],
    },
    {
      table: "auth_sessions",
      policy: "auth_sessions_tenant_isolation",
      roles: ["booking_app"],
    },
  ]);
});

test("tenant, missing-context, cross-tenant, and platform paths are isolated", async () => {
  const userId = await createUser();
  const tenantAId = await createTenant();
  const tenantBId = await createTenant();

  const tenantASessionId = await insertSession({
    userId,
    scopeType: "tenant",
    tenantId: tenantAId,
    role: "booking_app",
  });
  const tenantBSessionId = await insertSession({
    userId,
    scopeType: "tenant",
    tenantId: tenantBId,
    role: "booking_app",
  });
  const platformSessionId = await insertSession({
    userId,
    scopeType: "platform",
    role: "booking_platform_app",
  });

  await insertToken({
    sessionId: tenantASessionId,
    scopeType: "tenant",
    tenantId: tenantAId,
    role: "booking_app",
  });
  await insertToken({
    sessionId: tenantBSessionId,
    scopeType: "tenant",
    tenantId: tenantBId,
    role: "booking_app",
  });
  await insertToken({
    sessionId: platformSessionId,
    scopeType: "platform",
    role: "booking_platform_app",
  });

  const tenantARows = await runAsRole(
    "booking_app",
    tenantAId,
    (transaction) =>
      transaction.$queryRaw<readonly { id: string; tenant_id: string | null }[]>`
      SELECT "id", "tenant_id"
      FROM "auth_sessions"
      WHERE "id" IN (
        ${tenantASessionId}::uuid,
        ${tenantBSessionId}::uuid,
        ${platformSessionId}::uuid
      )
      ORDER BY "id"
    `,
  );
  assert.deepEqual(tenantARows, [{ id: tenantASessionId, tenant_id: tenantAId }]);

  const tenantATokens = await runAsRole(
    "booking_app",
    tenantAId,
    (transaction) =>
      transaction.$queryRaw<readonly { session_id: string; tenant_id: string | null }[]>`
      SELECT "session_id", "tenant_id"
      FROM "auth_session_tokens"
      ORDER BY "session_id"
    `,
  );
  assert.deepEqual(tenantATokens, [{ session_id: tenantASessionId, tenant_id: tenantAId }]);

  const missingContextRows = await runAsRole(
    "booking_app",
    undefined,
    (transaction) =>
      transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "auth_sessions"
    `,
  );
  assert.deepEqual(missingContextRows, []);

  await assert.rejects(
    runAsRole(
      "booking_app",
      tenantAId,
      (transaction) =>
        transaction.$executeRaw`
        UPDATE "auth_sessions"
        SET "state" = 'revoked'::auth_session_state,
            "revoked_at" = CURRENT_TIMESTAMP,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${tenantBSessionId}::uuid
      `,
    ).then((count) => {
      assert.equal(count, 1);
    }),
  );

  const platformRows = await runAsRole(
    "booking_platform_app",
    undefined,
    (transaction) =>
      transaction.$queryRaw<readonly { id: string; tenant_id: string | null }[]>`
      SELECT "id", "tenant_id"
      FROM "auth_sessions"
      WHERE "id" IN (
        ${tenantASessionId}::uuid,
        ${tenantBSessionId}::uuid,
        ${platformSessionId}::uuid
      )
      ORDER BY "id"
    `,
  );
  assert.deepEqual(platformRows, [{ id: platformSessionId, tenant_id: null }]);

  await assert.rejects(
    runAsRole(
      "booking_platform_app",
      undefined,
      (transaction) =>
        transaction.$executeRaw`
        UPDATE "auth_sessions"
        SET "state" = 'revoked'::auth_session_state,
            "revoked_at" = CURRENT_TIMESTAMP,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${tenantASessionId}::uuid
      `,
    ).then((count) => {
      assert.equal(count, 1);
    }),
  );
});
