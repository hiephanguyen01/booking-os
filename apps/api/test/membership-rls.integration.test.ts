import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

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

async function createTenant(): Promise<string> {
  const tenantId = randomUUID();
  const slug = `membership-rls-${tenantId.slice(0, 8)}`;
  await prisma.$executeRaw`
    INSERT INTO "tenants" ("id", "slug", "name", "status")
    VALUES (${tenantId}::uuid, ${slug}, ${slug}, 'provisioning'::tenant_status)
  `;
  createdTenantIds.push(tenantId);
  return tenantId;
}

async function seedTenantRows(tenantId: string, userId: string): Promise<void> {
  const role = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "roles" WHERE "key" = 'tenant_admin'
  `;
  const roleId = role[0]?.id;
  assert.ok(roleId);
  const email = `${userId}@example.test`;

  await runAsRole("booking_app", tenantId, async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "tenant_memberships" (
        "id", "tenant_id", "user_id", "status", "authorization_version",
        "accepted_at", "created_at", "updated_at"
      )
      VALUES (
        ${randomUUID()}::uuid, ${tenantId}::uuid, ${userId}::uuid,
        'active'::tenant_membership_status, 1, CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "membership_invitations" (
        "id", "tenant_id", "normalized_email", "invited_user_id",
        "intended_role_key", "status", "hostname", "selector", "token_hash",
        "expires_at", "invited_by_user_id", "created_at", "updated_at"
      )
      VALUES (
        ${randomUUID()}::uuid, ${tenantId}::uuid, ${email}, ${userId}::uuid,
        'tenant_admin', 'pending'::membership_invitation_status,
        ${`${tenantId.slice(0, 8)}.example.test`}, ${randomUUID()}, ${"b".repeat(64)},
        CURRENT_TIMESTAMP + INTERVAL '24 hours', ${userId}::uuid,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "role_assignments" (
        "id", "user_id", "role_id", "scope_level", "tenant_id", "created_at"
      )
      VALUES (
        ${randomUUID()}::uuid, ${userId}::uuid, ${roleId}::uuid,
        'tenant'::role_scope_level, ${tenantId}::uuid, CURRENT_TIMESTAMP
      )
    `;
  });
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

test("membership and tenant role tables use FORCE RLS with exact policies", async () => {
  const tables = await prisma.$queryRaw<
    readonly { table_name: string; rls_enabled: boolean; rls_forced: boolean }[]
  >`
    SELECT c.relname AS table_name,
           c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('tenant_memberships', 'membership_invitations', 'role_assignments')
    ORDER BY c.relname
  `;
  assert.deepEqual(tables, [
    { table_name: "membership_invitations", rls_enabled: true, rls_forced: true },
    { table_name: "role_assignments", rls_enabled: true, rls_forced: true },
    { table_name: "tenant_memberships", rls_enabled: true, rls_forced: true },
  ]);

  const policies = await prisma.$queryRaw<readonly { table_name: string; policy_name: string }[]>`
    SELECT tablename AS table_name, policyname AS policy_name
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('tenant_memberships', 'membership_invitations', 'role_assignments')
    ORDER BY tablename, policyname
  `;
  assert.deepEqual(policies, [
    {
      table_name: "membership_invitations",
      policy_name: "membership_invitations_tenant_isolation",
    },
    { table_name: "role_assignments", policy_name: "role_assignments_platform_scope" },
    { table_name: "role_assignments", policy_name: "role_assignments_tenant_isolation" },
    {
      table_name: "tenant_memberships",
      policy_name: "tenant_memberships_tenant_isolation",
    },
  ]);
});

test("tenant rows deny missing context and cross-tenant access while platform assignments stay separate", async () => {
  const tenantAId = await createTenant();
  const tenantBId = await createTenant();
  const tenantAUserId = await createUser();
  const tenantBUserId = await createUser();
  const platformUserId = await createUser();
  await seedTenantRows(tenantAId, tenantAUserId);
  await seedTenantRows(tenantBId, tenantBUserId);

  const platformRole = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "roles" WHERE "key" = 'platform_admin'
  `;
  const platformRoleId = platformRole[0]?.id;
  assert.ok(platformRoleId);
  await runAsRole(
    "booking_platform_app",
    undefined,
    (transaction) => transaction.$executeRaw`
      INSERT INTO "role_assignments" (
        "id", "user_id", "role_id", "scope_level", "created_at"
      )
      VALUES (
        ${randomUUID()}::uuid, ${platformUserId}::uuid, ${platformRoleId}::uuid,
        'platform'::role_scope_level, CURRENT_TIMESTAMP
      )
    `,
  );

  const tenantMemberships = await runAsRole(
    "booking_app",
    tenantAId,
    (transaction) => transaction.$queryRaw<readonly { user_id: string }[]>`
      SELECT "user_id" FROM "tenant_memberships" ORDER BY "user_id"
    `,
  );
  assert.deepEqual(tenantMemberships, [{ user_id: tenantAUserId }]);

  const tenantInvitations = await runAsRole(
    "booking_app",
    tenantAId,
    (transaction) => transaction.$queryRaw<readonly { invited_user_id: string | null }[]>`
      SELECT "invited_user_id" FROM "membership_invitations" ORDER BY "invited_user_id"
    `,
  );
  assert.deepEqual(tenantInvitations, [{ invited_user_id: tenantAUserId }]);

  const tenantAssignments = await runAsRole(
    "booking_app",
    tenantAId,
    (transaction) => transaction.$queryRaw<
      readonly { user_id: string; tenant_id: string | null }[]
    >`
      SELECT "user_id", "tenant_id" FROM "role_assignments" ORDER BY "user_id"
    `,
  );
  assert.deepEqual(tenantAssignments, [{ user_id: tenantAUserId, tenant_id: tenantAId }]);

  const missingContext = await runAsRole(
    "booking_app",
    undefined,
    (transaction) => transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "tenant_memberships"
    `,
  );
  assert.deepEqual(missingContext, []);

  const crossTenantCount = await runAsRole(
    "booking_app",
    tenantAId,
    (transaction) => transaction.$executeRaw`
      UPDATE "tenant_memberships"
      SET "authorization_version" = "authorization_version" + 1,
          "updated_at" = CURRENT_TIMESTAMP
      WHERE "tenant_id" = ${tenantBId}::uuid
    `,
  );
  assert.equal(crossTenantCount, 0);

  const platformAssignments = await runAsRole(
    "booking_platform_app",
    undefined,
    (transaction) => transaction.$queryRaw<
      readonly { user_id: string; tenant_id: string | null }[]
    >`
      SELECT "user_id", "tenant_id" FROM "role_assignments" ORDER BY "user_id"
    `,
  );
  assert.deepEqual(platformAssignments, [{ user_id: platformUserId, tenant_id: null }]);
});
