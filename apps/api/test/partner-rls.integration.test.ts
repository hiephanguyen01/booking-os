import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

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
  const slug = `partner-rls-${tenantId.slice(0, 8)}`;
  await prisma.$executeRaw`
    INSERT INTO "tenants" ("id", "slug", "name", "status")
    VALUES (${tenantId}::uuid, ${slug}, ${slug}, 'provisioning'::tenant_status)
  `;
  createdTenantIds.push(tenantId);
  return tenantId;
}

async function createActiveMembership(tenantId: string): Promise<string> {
  const userId = randomUUID();
  const membershipId = randomUUID();
  const email = `${userId}@example.test`;

  await prisma.$executeRaw`
    INSERT INTO "users" (
      "id", "normalized_email", "display_email", "status",
      "authorization_version", "created_at", "updated_at"
    ) VALUES (
      ${userId}::uuid, ${email}, ${email}, 'active', 1,
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  createdUserIds.push(userId);

  await runAsTenant(
    tenantId,
    (transaction) => transaction.$executeRaw`
      INSERT INTO "tenant_memberships" (
        "id", "tenant_id", "user_id", "status", "authorization_version",
        "accepted_at", "created_at", "updated_at"
      ) VALUES (
        ${membershipId}::uuid, ${tenantId}::uuid, ${userId}::uuid,
        'active'::tenant_membership_status, 1, CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `,
  );

  return membershipId;
}

after(async () => {
  try {
    if (createdTenantIds.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM "tenants" WHERE "id" = ANY(${createdTenantIds}::uuid[])
      `;
    }
    if (createdUserIds.length > 0) {
      await prisma.$executeRaw`
        DELETE FROM "users" WHERE "id" = ANY(${createdUserIds}::uuid[])
      `;
    }
  } catch {
    // RED intentionally runs before Partner persistence exists.
  } finally {
    await prisma.$disconnect();
  }
});

test("all Partner-owned authority tables use canonical app.tenant_id FORCE RLS", async () => {
  const expectedTables = ["partner_memberships", "partner_system_role_assignments", "partners"];
  const tables = await prisma.$queryRaw<
    readonly { table_name: string; rls_enabled: boolean; rls_forced: boolean }[]
  >`
    SELECT c.relname AS table_name,
           c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(${expectedTables}::text[])
    ORDER BY c.relname
  `;
  assert.deepEqual(tables, [
    { table_name: "partner_memberships", rls_enabled: true, rls_forced: true },
    { table_name: "partner_system_role_assignments", rls_enabled: true, rls_forced: true },
    { table_name: "partners", rls_enabled: true, rls_forced: true },
  ]);

  const policies = await prisma.$queryRaw<
    readonly {
      table_name: string;
      policy_name: string;
      qual: string | null;
      with_check: string | null;
    }[]
  >`
    SELECT tablename AS table_name, policyname AS policy_name, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(${expectedTables}::text[])
    ORDER BY tablename, policyname
  `;
  assert.deepEqual(
    policies.map(({ table_name, policy_name }) => ({ table_name, policy_name })),
    [
      { table_name: "partner_memberships", policy_name: "partner_memberships_tenant_isolation" },
      {
        table_name: "partner_system_role_assignments",
        policy_name: "partner_system_role_assignments_tenant_isolation",
      },
      { table_name: "partners", policy_name: "partners_tenant_isolation" },
    ],
  );
  for (const policy of policies) {
    assert.match(policy.qual ?? "", /app\.tenant_id/);
    assert.match(policy.with_check ?? "", /app\.tenant_id/);
    assert.doesNotMatch(policy.qual ?? "", /app\.partner_id/);
    assert.doesNotMatch(policy.with_check ?? "", /app\.partner_id/);
  }
});

test("foreign and missing tenant context cannot observe or mutate Partner authority rows", async () => {
  const tenantAId = await createTenant();
  const tenantBId = await createTenant();
  const membershipId = await createActiveMembership(tenantAId);
  const partnerId = randomUUID();
  const partnerMembershipId = randomUUID();
  const assignmentId = randomUUID();
  const roleRows = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "roles" WHERE "key" = 'partner_owner'
  `;
  const partnerOwnerRoleId = roleRows[0]?.id;
  assert.ok(partnerOwnerRoleId);

  await runAsTenant(tenantAId, async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "partners" ("id", "tenant_id", "type")
      VALUES (${partnerId}::uuid, ${tenantAId}::uuid, 'company')
    `;
    await transaction.$executeRaw`
      INSERT INTO "partner_memberships" (
        "id", "tenant_id", "partner_id", "tenant_membership_id"
      ) VALUES (
        ${partnerMembershipId}::uuid, ${tenantAId}::uuid,
        ${partnerId}::uuid, ${membershipId}::uuid
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "partner_system_role_assignments" (
        "id", "tenant_id", "partner_id", "partner_membership_id", "role_id"
      ) VALUES (
        ${assignmentId}::uuid, ${tenantAId}::uuid, ${partnerId}::uuid,
        ${partnerMembershipId}::uuid, ${partnerOwnerRoleId}::uuid
      )
    `;
  });

  for (const deniedTenantId of [tenantBId, undefined]) {
    assert.deepEqual(
      await runAsTenant(
        deniedTenantId,
        (transaction) => transaction.$queryRaw<readonly { id: string }[]>`
          SELECT "id" FROM "partners" WHERE "id" = ${partnerId}::uuid
        `,
      ),
      [],
    );
    assert.deepEqual(
      await runAsTenant(
        deniedTenantId,
        (transaction) => transaction.$queryRaw<readonly { id: string }[]>`
          SELECT "id" FROM "partner_memberships" WHERE "id" = ${partnerMembershipId}::uuid
        `,
      ),
      [],
    );
    assert.deepEqual(
      await runAsTenant(
        deniedTenantId,
        (transaction) => transaction.$queryRaw<readonly { id: string }[]>`
          SELECT "id" FROM "partner_system_role_assignments" WHERE "id" = ${assignmentId}::uuid
        `,
      ),
      [],
    );

    assert.equal(
      await runAsTenant(
        deniedTenantId,
        (transaction) => transaction.$executeRaw`
          UPDATE "partners"
          SET "version" = "version" + 1
          WHERE "id" = ${partnerId}::uuid
        `,
      ),
      0,
    );
    assert.equal(
      await runAsTenant(
        deniedTenantId,
        (transaction) => transaction.$executeRaw`
          UPDATE "partner_memberships"
          SET "authorization_version" = "authorization_version" + 1
          WHERE "id" = ${partnerMembershipId}::uuid
        `,
      ),
      0,
    );
    assert.equal(
      await runAsTenant(
        deniedTenantId,
        (transaction) => transaction.$executeRaw`
          UPDATE "partner_system_role_assignments"
          SET "revoked_at" = CURRENT_TIMESTAMP
          WHERE "id" = ${assignmentId}::uuid
        `,
      ),
      0,
    );

    await assert.rejects(
      runAsTenant(
        deniedTenantId,
        (transaction) => transaction.$executeRaw`
          INSERT INTO "partners" ("id", "tenant_id", "type")
          VALUES (${randomUUID()}::uuid, ${tenantAId}::uuid, 'individual')
        `,
      ),
    );
  }

  const visible = await runAsTenant(tenantAId, async (transaction) => ({
    partners: await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "partners" WHERE "id" = ${partnerId}::uuid
    `,
    memberships: await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "partner_memberships" WHERE "id" = ${partnerMembershipId}::uuid
    `,
    assignments: await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "partner_system_role_assignments" WHERE "id" = ${assignmentId}::uuid
    `,
  }));
  assert.deepEqual(visible, {
    partners: [{ id: partnerId }],
    memberships: [{ id: partnerMembershipId }],
    assignments: [{ id: assignmentId }],
  });
});