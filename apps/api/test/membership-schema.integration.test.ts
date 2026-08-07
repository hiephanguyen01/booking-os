import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

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

async function createUser(): Promise<string> {
  const userId = randomUUID();
  const email = `${userId}@example.test`;
  await prisma.$executeRaw`
    INSERT INTO "users" (
      "id", "normalized_email", "display_email", "status",
      "authorization_version", "created_at", "updated_at"
    )
    VALUES (
      ${userId}::uuid, ${email}, ${email}, 'active', 1,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  createdUserIds.push(userId);
  return userId;
}

async function createTenant(status: "provisioning" | "active" | "suspended" = "provisioning") {
  const tenantId = randomUUID();
  const slug = `membership-${tenantId.slice(0, 8)}`;
  await prisma.$executeRaw`
    INSERT INTO "tenants" ("id", "slug", "name", "status")
    VALUES (${tenantId}::uuid, ${slug}, ${slug}, ${status}::tenant_status)
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
    if (createdTenantIds.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM "tenants"
        WHERE "id" = ANY(${createdTenantIds}::uuid[])
      `;
    }
    if (createdUserIds.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM "users"
        WHERE "id" = ANY(${createdUserIds}::uuid[])
      `;
    }
  } catch {
    // RED intentionally runs before membership persistence exists.
  } finally {
    await prisma.$disconnect();
  }
});

test("membership migration creates lifecycle tables and tenant status", async () => {
  const expectedTables = ["membership_invitations", "tenant_domains", "tenant_memberships"];
  const tables = await prisma.$queryRaw<readonly { table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${expectedTables}::text[])
    ORDER BY table_name
  `;
  assert.deepEqual(
    tables.map((row) => row.table_name),
    expectedTables,
  );

  const statuses = await prisma.$queryRaw<readonly { enumlabel: string }[]>`
    SELECT enumlabel
    FROM pg_enum
    INNER JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
    WHERE pg_type.typname = 'tenant_status'
    ORDER BY pg_enum.enumsortorder
  `;
  assert.deepEqual(
    statuses.map((row) => row.enumlabel),
    ["provisioning", "active", "suspended"],
  );
});

test("tenant domains are normalized, globally unique, and have one primary hostname", async () => {
  const tenantId = await createTenant();
  const otherTenantId = await createTenant();
  const hostname = `${tenantId.slice(0, 8)}.example.test`;

  await prisma.$executeRaw`
    INSERT INTO "tenant_domains" ("id", "tenant_id", "hostname", "is_primary", "created_at")
    VALUES (${randomUUID()}::uuid, ${tenantId}::uuid, ${hostname}, TRUE, CURRENT_TIMESTAMP)
  `;

  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "tenant_domains" ("id", "tenant_id", "hostname", "is_primary", "created_at")
      VALUES (${randomUUID()}::uuid, ${otherTenantId}::uuid, ${hostname}, TRUE, CURRENT_TIMESTAMP)
    `,
  );
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "tenant_domains" ("id", "tenant_id", "hostname", "is_primary", "created_at")
      VALUES (
        ${randomUUID()}::uuid,
        ${tenantId}::uuid,
        ${`second-${hostname}`},
        TRUE,
        CURRENT_TIMESTAMP
      )
    `,
  );
  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "tenant_domains" ("id", "tenant_id", "hostname", "is_primary", "created_at")
      VALUES (
        ${randomUUID()}::uuid,
        ${otherTenantId}::uuid,
        'UPPER.example.test',
        FALSE,
        CURRENT_TIMESTAMP
      )
    `,
  );
});

test("memberships are unique per tenant and user with exact lifecycle constraints", async () => {
  const tenantId = await createTenant();
  const userId = await createUser();

  await runAsTenant(
    tenantId,
    (transaction) => transaction.$executeRaw`
      INSERT INTO "tenant_memberships" (
        "id", "tenant_id", "user_id", "status", "authorization_version",
        "created_at", "updated_at"
      )
      VALUES (
        ${randomUUID()}::uuid, ${tenantId}::uuid, ${userId}::uuid,
        'invited'::tenant_membership_status, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `,
  );

  await assert.rejects(
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_memberships" (
          "id", "tenant_id", "user_id", "status", "authorization_version",
          "created_at", "updated_at"
        )
        VALUES (
          ${randomUUID()}::uuid, ${tenantId}::uuid, ${userId}::uuid,
          'invited'::tenant_membership_status, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `,
    ),
  );

  const otherUserId = await createUser();
  await assert.rejects(
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_memberships" (
          "id", "tenant_id", "user_id", "status", "authorization_version",
          "created_at", "updated_at"
        )
        VALUES (
          ${randomUUID()}::uuid, ${tenantId}::uuid, ${otherUserId}::uuid,
          'active'::tenant_membership_status, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `,
    ),
  );

  await assert.rejects(
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_memberships" (
          "id", "tenant_id", "user_id", "status", "authorization_version",
          "created_at", "updated_at"
        )
        VALUES (
          ${randomUUID()}::uuid, ${tenantId}::uuid, ${otherUserId}::uuid,
          'invited'::tenant_membership_status, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `,
    ),
  );
});

test("invitations are single-use digests bound to tenant, email, hostname, and tenant role", async () => {
  const tenantId = await createTenant();
  const invitedUserId = await createUser();
  const inviterUserId = await createUser();
  const email = `${randomUUID()}@example.test`;
  const hostname = `${tenantId.slice(0, 8)}.example.test`;

  const insertInvitation = (roleKey: string, status = "pending") =>
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "membership_invitations" (
          "id", "tenant_id", "normalized_email", "invited_user_id",
          "intended_role_key", "status", "hostname", "selector", "token_hash",
          "expires_at", "invited_by_user_id", "created_at", "updated_at"
        )
        VALUES (
          ${randomUUID()}::uuid, ${tenantId}::uuid, ${email}, ${invitedUserId}::uuid,
          ${roleKey}, ${status}::membership_invitation_status, ${hostname},
          ${randomUUID()}, ${"a".repeat(64)}, CURRENT_TIMESTAMP + INTERVAL '24 hours',
          ${inviterUserId}::uuid, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `,
    );

  await insertInvitation("tenant_admin");
  await assert.rejects(insertInvitation("tenant_admin"));
  await assert.rejects(insertInvitation("platform_admin"));
  await assert.rejects(insertInvitation("tenant_owner", "accepted"));

  const columns = await tableColumns("membership_invitations");
  assert.equal(columns.includes("selector"), true);
  assert.equal(columns.includes("token_hash"), true);
  for (const forbidden of ["token", "raw_token", "secret", "raw_secret"]) {
    assert.equal(columns.includes(forbidden), false);
  }
});

test("tenant role assignments require an active membership and a matching tenant role", async () => {
  const tenantId = await createTenant();
  const userId = await createUser();
  const otherUserId = await createUser();
  const roles = await prisma.$queryRaw<readonly { id: string; key: string }[]>`
    SELECT "id", "key"
    FROM "roles"
    WHERE "key" IN ('platform_admin', 'tenant_admin')
    ORDER BY "key"
  `;
  const platformRoleId = roles.find((role) => role.key === "platform_admin")?.id;
  const tenantAdminRoleId = roles.find((role) => role.key === "tenant_admin")?.id;
  assert.ok(platformRoleId);
  assert.ok(tenantAdminRoleId);

  await runAsTenant(
    tenantId,
    (transaction) => transaction.$executeRaw`
      INSERT INTO "tenant_memberships" (
        "id", "tenant_id", "user_id", "status", "authorization_version",
        "accepted_at", "created_at", "updated_at"
      )
      VALUES (
        ${randomUUID()}::uuid, ${tenantId}::uuid, ${userId}::uuid,
        'active'::tenant_membership_status, 1, CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `,
  );

  await runAsTenant(
    tenantId,
    (transaction) => transaction.$executeRaw`
      INSERT INTO "role_assignments" (
        "id", "user_id", "role_id", "scope_level", "tenant_id", "created_at"
      )
      VALUES (
        ${randomUUID()}::uuid, ${userId}::uuid, ${tenantAdminRoleId}::uuid,
        'tenant'::role_scope_level, ${tenantId}::uuid, CURRENT_TIMESTAMP
      )
    `,
  );

  await assert.rejects(
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "role_assignments" (
          "id", "user_id", "role_id", "scope_level", "tenant_id", "created_at"
        )
        VALUES (
          ${randomUUID()}::uuid, ${otherUserId}::uuid, ${tenantAdminRoleId}::uuid,
          'tenant'::role_scope_level, ${tenantId}::uuid, CURRENT_TIMESTAMP
        )
      `,
    ),
  );
  await assert.rejects(
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "role_assignments" (
          "id", "user_id", "role_id", "scope_level", "tenant_id", "created_at"
        )
        VALUES (
          ${randomUUID()}::uuid, ${userId}::uuid, ${platformRoleId}::uuid,
          'tenant'::role_scope_level, ${tenantId}::uuid, CURRENT_TIMESTAMP
        )
      `,
    ),
  );
});

test("tenant authorization catalog is deterministic", async () => {
  const rows = await prisma.$queryRaw<readonly { role_key: string; permission_key: string }[]>`
    SELECT role."key" AS role_key, permission."key" AS permission_key
    FROM "roles" role
    INNER JOIN "role_permissions" role_permission
      ON role_permission."role_id" = role."id"
    INNER JOIN "permissions" permission
      ON permission."id" = role_permission."permission_id"
    WHERE role."key" IN ('tenant_owner', 'tenant_admin')
    ORDER BY role."key", permission."key"
  `;

  const byRole = new Map<string, string[]>();
  for (const row of rows) {
    const permissions = byRole.get(row.role_key) ?? [];
    permissions.push(row.permission_key);
    byRole.set(row.role_key, permissions);
  }

  assert.deepEqual(byRole.get("tenant_admin"), [
    "tenant.membership.admin.invite",
    "tenant.membership.admin.revoke",
    "tenant.membership.admin.suspend",
    "tenant.membership.read",
    "tenant.security.session.read",
    "tenant.security.session.revoke",
  ]);
  assert.deepEqual(byRole.get("tenant_owner"), [
    "tenant.membership.admin.invite",
    "tenant.membership.admin.revoke",
    "tenant.membership.admin.suspend",
    "tenant.membership.owner.demote",
    "tenant.membership.owner.promote",
    "tenant.membership.read",
    "tenant.security.session.read",
    "tenant.security.session.revoke",
  ]);
});
