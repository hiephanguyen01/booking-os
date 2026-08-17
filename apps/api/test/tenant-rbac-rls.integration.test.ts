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
  const slug = `rbac-rls-${tenantId.slice(0, 8)}`;
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
    )
    VALUES (
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
      )
      VALUES (
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
    // RED intentionally runs before tenant custom-RBAC persistence exists.
  } finally {
    await prisma.$disconnect();
  }
});

test("all tenant custom RBAC tables use the canonical FORCE-RLS tenant contract", async () => {
  const expectedTables = [
    "tenant_custom_role_assignments",
    "tenant_custom_role_permissions",
    "tenant_custom_roles",
  ];
  const tables = await prisma.$queryRaw<
    readonly { table_name: string; rls_enabled: boolean; rls_forced: boolean }[]
  >`
    SELECT c.relname AS table_name,
           c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced
    FROM pg_class c
    INNER JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ANY(${expectedTables}::text[])
    ORDER BY c.relname
  `;
  assert.deepEqual(tables, [
    { table_name: "tenant_custom_role_assignments", rls_enabled: true, rls_forced: true },
    { table_name: "tenant_custom_role_permissions", rls_enabled: true, rls_forced: true },
    { table_name: "tenant_custom_roles", rls_enabled: true, rls_forced: true },
  ]);

  const policies = await prisma.$queryRaw<
    readonly {
      table_name: string;
      policy_name: string;
      qual: string | null;
      with_check: string | null;
    }[]
  >`
    SELECT tablename AS table_name,
           policyname AS policy_name,
           qual,
           with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = ANY(${expectedTables}::text[])
    ORDER BY tablename, policyname
  `;
  assert.deepEqual(
    policies.map(({ table_name, policy_name }) => ({ table_name, policy_name })),
    [
      {
        table_name: "tenant_custom_role_assignments",
        policy_name: "tenant_custom_role_assignments_tenant_isolation",
      },
      {
        table_name: "tenant_custom_role_permissions",
        policy_name: "tenant_custom_role_permissions_tenant_isolation",
      },
      {
        table_name: "tenant_custom_roles",
        policy_name: "tenant_custom_roles_tenant_isolation",
      },
    ],
  );
  for (const policy of policies) {
    assert.match(policy.qual ?? "", /app\.tenant_id/);
    assert.match(policy.with_check ?? "", /app\.tenant_id/);
    assert.doesNotMatch(policy.qual ?? "", /app\.current_tenant_id/);
    assert.doesNotMatch(policy.with_check ?? "", /app\.current_tenant_id/);
  }

  const grants = await prisma.$queryRaw<readonly { table_name: string; privilege_type: string }[]>`
    SELECT table_name, privilege_type
    FROM information_schema.table_privileges
    WHERE table_schema = 'public'
      AND table_name = ANY(${expectedTables}::text[])
      AND grantee = 'booking_app'
    ORDER BY table_name, privilege_type
  `;
  for (const table of expectedTables) {
    assert.deepEqual(
      grants
        .filter((grant) => grant.table_name === table)
        .map((grant) => grant.privilege_type)
        .sort(),
      ["DELETE", "INSERT", "SELECT", "UPDATE"],
    );
  }
});

test("foreign and missing tenant context deny CRUD across all custom-RBAC tables", async () => {
  const tenantAId = await createTenant();
  const tenantBId = await createTenant();
  const membershipId = await createActiveMembership(tenantAId);
  const insertMembershipId = await createActiveMembership(tenantAId);
  const roleId = randomUUID();
  const insertPermissionRoleId = randomUUID();
  const insertAssignmentRoleId = randomUUID();
  const assignmentId = randomUUID();
  const tenantPermission = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "permissions" WHERE "key" = 'tenant.membership.read'
  `;
  const permissionId = tenantPermission[0]?.id;
  assert.ok(permissionId);

  await runAsTenant(tenantAId, async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES
        (${roleId}::uuid, ${tenantAId}::uuid, 'Source Role', 'source role', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (${insertPermissionRoleId}::uuid, ${tenantAId}::uuid, 'Permission Target', 'permission target', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (${insertAssignmentRoleId}::uuid, ${tenantAId}::uuid, 'Assignment Target', 'assignment target', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_role_permissions" (
        "tenant_id", "role_id", "permission_id", "created_at"
      ) VALUES (
        ${tenantAId}::uuid, ${roleId}::uuid, ${permissionId}::uuid, CURRENT_TIMESTAMP
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_role_assignments" (
        "id", "tenant_id", "membership_id", "role_id", "created_at"
      ) VALUES (
        ${assignmentId}::uuid, ${tenantAId}::uuid, ${membershipId}::uuid, ${roleId}::uuid,
        CURRENT_TIMESTAMP
      )
    `;
  });

  for (const deniedTenantId of [tenantBId, undefined]) {
    const visibleRoles = await runAsTenant(
      deniedTenantId,
      (transaction) => transaction.$queryRaw<readonly { id: string }[]>`
        SELECT "id" FROM "tenant_custom_roles" WHERE "id" = ${roleId}::uuid
      `,
    );
    assert.deepEqual(visibleRoles, []);

    const visibleMappings = await runAsTenant(
      deniedTenantId,
      (transaction) => transaction.$queryRaw<readonly { role_id: string }[]>`
        SELECT "role_id"
        FROM "tenant_custom_role_permissions"
        WHERE "role_id" = ${roleId}::uuid AND "permission_id" = ${permissionId}::uuid
      `,
    );
    assert.deepEqual(visibleMappings, []);

    const visibleAssignments = await runAsTenant(
      deniedTenantId,
      (transaction) => transaction.$queryRaw<readonly { id: string }[]>`
        SELECT "id" FROM "tenant_custom_role_assignments" WHERE "id" = ${assignmentId}::uuid
      `,
    );
    assert.deepEqual(visibleAssignments, []);

    const updatedRoles = await runAsTenant(
      deniedTenantId,
      (transaction) => transaction.$executeRaw`
        UPDATE "tenant_custom_roles"
        SET "name" = 'Compromised', "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${roleId}::uuid
      `,
    );
    assert.equal(updatedRoles, 0);

    const updatedMappings = await runAsTenant(
      deniedTenantId,
      (transaction) => transaction.$executeRaw`
        UPDATE "tenant_custom_role_permissions"
        SET "created_at" = CURRENT_TIMESTAMP
        WHERE "role_id" = ${roleId}::uuid AND "permission_id" = ${permissionId}::uuid
      `,
    );
    assert.equal(updatedMappings, 0);

    const updatedAssignments = await runAsTenant(
      deniedTenantId,
      (transaction) => transaction.$executeRaw`
        UPDATE "tenant_custom_role_assignments"
        SET "created_at" = CURRENT_TIMESTAMP
        WHERE "id" = ${assignmentId}::uuid
      `,
    );
    assert.equal(updatedAssignments, 0);

    await assert.rejects(
      runAsTenant(
        deniedTenantId,
        (transaction) => transaction.$executeRaw`
          INSERT INTO "tenant_custom_roles" (
            "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
          ) VALUES (
            ${randomUUID()}::uuid, ${tenantAId}::uuid, 'Denied Role', ${`denied role ${randomUUID()}`}, 1,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
        `,
      ),
    );

    await assert.rejects(
      runAsTenant(
        deniedTenantId,
        (transaction) => transaction.$executeRaw`
          INSERT INTO "tenant_custom_role_permissions" (
            "tenant_id", "role_id", "permission_id", "created_at"
          ) VALUES (
            ${tenantAId}::uuid, ${insertPermissionRoleId}::uuid, ${permissionId}::uuid,
            CURRENT_TIMESTAMP
          )
        `,
      ),
    );

    await assert.rejects(
      runAsTenant(
        deniedTenantId,
        (transaction) => transaction.$executeRaw`
          INSERT INTO "tenant_custom_role_assignments" (
            "id", "tenant_id", "membership_id", "role_id", "created_at"
          ) VALUES (
            ${randomUUID()}::uuid, ${tenantAId}::uuid, ${insertMembershipId}::uuid,
            ${insertAssignmentRoleId}::uuid, CURRENT_TIMESTAMP
          )
        `,
      ),
    );

    const deletedRoles = await runAsTenant(
      deniedTenantId,
      (transaction) => transaction.$executeRaw`
        DELETE FROM "tenant_custom_roles" WHERE "id" = ${roleId}::uuid
      `,
    );
    assert.equal(deletedRoles, 0);

    const deletedMappings = await runAsTenant(
      deniedTenantId,
      (transaction) => transaction.$executeRaw`
        DELETE FROM "tenant_custom_role_permissions"
        WHERE "role_id" = ${roleId}::uuid AND "permission_id" = ${permissionId}::uuid
      `,
    );
    assert.equal(deletedMappings, 0);

    const deletedAssignments = await runAsTenant(
      deniedTenantId,
      (transaction) => transaction.$executeRaw`
        DELETE FROM "tenant_custom_role_assignments" WHERE "id" = ${assignmentId}::uuid
      `,
    );
    assert.equal(deletedAssignments, 0);
  }

  const visibleSourceRows = await runAsTenant(tenantAId, async (transaction) => ({
    roles: await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "tenant_custom_roles" WHERE "id" = ${roleId}::uuid
    `,
    mappings: await transaction.$queryRaw<readonly { role_id: string }[]>`
      SELECT "role_id"
      FROM "tenant_custom_role_permissions"
      WHERE "role_id" = ${roleId}::uuid AND "permission_id" = ${permissionId}::uuid
    `,
    assignments: await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "tenant_custom_role_assignments" WHERE "id" = ${assignmentId}::uuid
    `,
  }));
  assert.deepEqual(visibleSourceRows, {
    roles: [{ id: roleId }],
    mappings: [{ role_id: roleId }],
    assignments: [{ id: assignmentId }],
  });
});
