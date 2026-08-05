import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const createdUserIds: string[] = [];
const createdTenantIds: string[] = [];

async function createUser(normalizedEmail = `${randomUUID()}@example.test`): Promise<string> {
  const userId = randomUUID();

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
      ${normalizedEmail},
      ${normalizedEmail},
      'pending_activation',
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
  const slug = `identity-${tenantId.slice(0, 8)}`;

  await prisma.$executeRaw`
    INSERT INTO "tenants" ("id", "slug", "name")
    VALUES (${tenantId}::uuid, ${slug}, ${slug})
  `;
  createdTenantIds.push(tenantId);

  return tenantId;
}

async function tableColumns(tableName: string): Promise<readonly string[]> {
  const rows = await prisma.$queryRaw<readonly { column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
    ORDER BY ordinal_position
  `;

  return rows.map((row) => row.column_name);
}

after(async () => {
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
  } catch {
    // The RED phase intentionally runs before the identity tables exist.
  } finally {
    await prisma.$disconnect();
  }
});

test("identity migration creates the complete global schema", async () => {
  const expectedTables = [
    "account_activation_tokens",
    "password_credentials",
    "password_reset_tokens",
    "permissions",
    "role_assignments",
    "role_permissions",
    "roles",
    "security_audit_events",
    "users",
  ];
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

test("normalized email is globally unique and user status is constrained", async () => {
  const normalizedEmail = `${randomUUID()}@example.test`;
  await createUser(normalizedEmail);

  await assert.rejects(createUser(normalizedEmail));

  const userId = randomUUID();
  await assert.rejects(
    prisma.$executeRaw`
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
        ${`${randomUUID()}@example.test`},
        'invalid@example.test',
        'deleted',
        1,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
  );
});

test("a user can have only one password credential", async () => {
  const userId = await createUser();

  await prisma.$executeRaw`
    INSERT INTO "password_credentials" (
      "user_id",
      "password_hash",
      "algorithm",
      "parameters",
      "created_at",
      "updated_at"
    )
    VALUES (
      ${userId}::uuid,
      '$argon2id$v=19$m=65536,t=3,p=1$first',
      'argon2id',
      ${JSON.stringify({ memoryCostKiB: 65_536, timeCost: 3, parallelism: 1 })}::jsonb,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
  `;

  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "password_credentials" (
        "user_id",
        "password_hash",
        "algorithm",
        "parameters",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${userId}::uuid,
        '$argon2id$v=19$m=65536,t=3,p=1$second',
        'argon2id',
        '{}'::jsonb,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
  );
});

test("activation tokens enforce scope shape, lifecycle, and one active token", async () => {
  const userId = await createUser();
  const tenantId = await createTenant();
  const hostname = `platform-${randomUUID()}.example.test`;

  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "account_activation_tokens" (
        "id",
        "user_id",
        "scope_type",
        "tenant_id",
        "hostname",
        "selector",
        "token_hash",
        "expires_at",
        "created_at"
      )
      VALUES (
        ${randomUUID()}::uuid,
        ${userId}::uuid,
        'platform',
        ${tenantId}::uuid,
        ${hostname},
        ${randomUUID()},
        ${"1".repeat(64)},
        CURRENT_TIMESTAMP + INTERVAL '24 hours',
        CURRENT_TIMESTAMP
      )
    `,
  );

  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "account_activation_tokens" (
        "id",
        "user_id",
        "scope_type",
        "tenant_id",
        "invitation_id",
        "hostname",
        "selector",
        "token_hash",
        "expires_at",
        "consumed_at",
        "revoked_at",
        "created_at"
      )
      VALUES (
        ${randomUUID()}::uuid,
        ${userId}::uuid,
        'tenant',
        ${tenantId}::uuid,
        ${randomUUID()}::uuid,
        ${`tenant-${randomUUID()}.example.test`},
        ${randomUUID()},
        ${"2".repeat(64)},
        CURRENT_TIMESTAMP + INTERVAL '24 hours',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `,
  );

  await prisma.$executeRaw`
    INSERT INTO "account_activation_tokens" (
      "id",
      "user_id",
      "scope_type",
      "hostname",
      "selector",
      "token_hash",
      "expires_at",
      "created_at"
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${userId}::uuid,
      'platform',
      ${hostname},
      ${randomUUID()},
      ${"3".repeat(64)},
      CURRENT_TIMESTAMP + INTERVAL '24 hours',
      CURRENT_TIMESTAMP
    )
  `;

  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "account_activation_tokens" (
        "id",
        "user_id",
        "scope_type",
        "hostname",
        "selector",
        "token_hash",
        "expires_at",
        "created_at"
      )
      VALUES (
        ${randomUUID()}::uuid,
        ${userId}::uuid,
        'platform',
        ${hostname},
        ${randomUUID()},
        ${"4".repeat(64)},
        CURRENT_TIMESTAMP + INTERVAL '24 hours',
        CURRENT_TIMESTAMP
      )
    `,
  );
});

test("platform role assignments have a valid shape and are unique while active", async () => {
  const userId = await createUser();
  const tenantId = await createTenant();
  const roles = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id"
    FROM "roles"
    WHERE "key" = 'platform_admin'
      AND "scope_level" = 'platform'
      AND "is_system" = TRUE
  `;
  assert.equal(roles.length, 1);
  const roleId = roles[0]?.id;
  assert.ok(roleId);

  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "role_assignments" (
        "id",
        "user_id",
        "role_id",
        "scope_level",
        "tenant_id",
        "created_at"
      )
      VALUES (
        ${randomUUID()}::uuid,
        ${userId}::uuid,
        ${roleId}::uuid,
        'platform',
        ${tenantId}::uuid,
        CURRENT_TIMESTAMP
      )
    `,
  );

  await prisma.$executeRaw`
    INSERT INTO "role_assignments" (
      "id",
      "user_id",
      "role_id",
      "scope_level",
      "created_at"
    )
    VALUES (
      ${randomUUID()}::uuid,
      ${userId}::uuid,
      ${roleId}::uuid,
      'platform',
      CURRENT_TIMESTAMP
    )
  `;

  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "role_assignments" (
        "id",
        "user_id",
        "role_id",
        "scope_level",
        "created_at"
      )
      VALUES (
        ${randomUUID()}::uuid,
        ${userId}::uuid,
        ${roleId}::uuid,
        'platform',
        CURRENT_TIMESTAMP
      )
    `,
  );
});

test("platform administrator catalog is deterministic", async () => {
  const rows = await prisma.$queryRaw<readonly { permission_key: string }[]>`
    SELECT permission."key" AS permission_key
    FROM "roles" role
    INNER JOIN "role_permissions" role_permission
      ON role_permission."role_id" = role."id"
    INNER JOIN "permissions" permission
      ON permission."id" = role_permission."permission_id"
    WHERE role."key" = 'platform_admin'
      AND role."scope_level" = 'platform'
      AND role."is_system" = TRUE
    ORDER BY permission."key"
  `;

  assert.deepEqual(
    rows.map((row) => row.permission_key),
    ["platform.security.audit.read", "platform.tenants.provision", "platform.users.provision"],
  );
});

test("credential and token tables expose no raw secret columns", async () => {
  const credentialColumns = await tableColumns("password_credentials");
  const activationColumns = await tableColumns("account_activation_tokens");
  const resetColumns = await tableColumns("password_reset_tokens");

  assert.equal(credentialColumns.includes("password_hash"), true);
  assert.equal(credentialColumns.includes("password"), false);
  assert.equal(credentialColumns.includes("raw_password"), false);

  for (const columns of [activationColumns, resetColumns]) {
    assert.equal(columns.includes("selector"), true);
    assert.equal(columns.includes("token_hash"), true);
    assert.equal(columns.includes("token"), false);
    assert.equal(columns.includes("raw_token"), false);
    assert.equal(columns.includes("secret"), false);
  }
});
