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

async function createTenant(): Promise<string> {
  const tenantId = randomUUID();
  const slug = `rbac-schema-${tenantId.slice(0, 8)}`;
  await prisma.$executeRaw`
    INSERT INTO "tenants" ("id", "slug", "name", "status")
    VALUES (${tenantId}::uuid, ${slug}, ${slug}, 'active'::tenant_status)
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

test("tenant custom RBAC migration creates all three tenant-owned tables", async () => {
  const expectedTables = [
    "tenant_custom_role_assignments",
    "tenant_custom_role_permissions",
    "tenant_custom_roles",
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

test("active normalized custom-role names are unique only within one tenant", async () => {
  const tenantAId = await createTenant();
  const tenantBId = await createTenant();
  const normalizedName = "dispatcher";

  await runAsTenant(
    tenantAId,
    (transaction) => transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}::uuid, ${tenantAId}::uuid, 'Dispatcher', ${normalizedName}, 1,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `,
  );

  await assert.rejects(
    runAsTenant(
      tenantAId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_custom_roles" (
          "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
        ) VALUES (
          ${randomUUID()}::uuid, ${tenantAId}::uuid, ' dispatcher ', ${normalizedName}, 1,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `,
    ),
  );

  await runAsTenant(
    tenantBId,
    (transaction) => transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}::uuid, ${tenantBId}::uuid, 'Dispatcher', ${normalizedName}, 1,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `,
  );
});

test("permission mappings enforce same-tenant role ownership, tenant permission scope, and archive state", async () => {
  const tenantAId = await createTenant();
  const tenantBId = await createTenant();
  const roleId = randomUUID();
  const archivedRoleId = randomUUID();
  const tenantPermission = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "permissions" WHERE "key" = 'tenant.membership.read'
  `;
  const platformPermission = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "permissions" WHERE "key" = 'platform.tenants.provision'
  `;
  assert.ok(tenantPermission[0]?.id);
  assert.ok(platformPermission[0]?.id);

  await runAsTenant(tenantAId, async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES (
        ${roleId}::uuid, ${tenantAId}::uuid, 'Operator', 'operator', 1,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "archived_at",
        "created_at", "updated_at"
      ) VALUES (
        ${archivedRoleId}::uuid, ${tenantAId}::uuid, 'Archived', 'archived', 1,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_role_permissions" (
        "tenant_id", "role_id", "permission_id", "created_at"
      ) VALUES (
        ${tenantAId}::uuid, ${roleId}::uuid, ${tenantPermission[0].id}::uuid, CURRENT_TIMESTAMP
      )
    `;
  });

  await assert.rejects(
    runAsTenant(
      tenantBId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_custom_role_permissions" (
          "tenant_id", "role_id", "permission_id", "created_at"
        ) VALUES (
          ${tenantBId}::uuid, ${roleId}::uuid, ${tenantPermission[0].id}::uuid, CURRENT_TIMESTAMP
        )
      `,
    ),
  );
  await assert.rejects(
    runAsTenant(
      tenantAId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_custom_role_permissions" (
          "tenant_id", "role_id", "permission_id", "created_at"
        ) VALUES (
          ${tenantAId}::uuid, ${roleId}::uuid, ${platformPermission[0].id}::uuid, CURRENT_TIMESTAMP
        )
      `,
    ),
  );
  await assert.rejects(
    runAsTenant(
      tenantAId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_custom_role_permissions" (
          "tenant_id", "role_id", "permission_id", "created_at"
        ) VALUES (
          ${tenantAId}::uuid, ${archivedRoleId}::uuid, ${tenantPermission[0].id}::uuid,
          CURRENT_TIMESTAMP
        )
      `,
    ),
  );
});

test("custom-role assignments require same-tenant active membership and role with one active row", async () => {
  const tenantAId = await createTenant();
  const tenantBId = await createTenant();
  const membershipId = await createActiveMembership(tenantAId);
  const roleId = randomUUID();
  const archivedRoleId = randomUUID();

  await runAsTenant(tenantAId, async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES (
        ${roleId}::uuid, ${tenantAId}::uuid, 'Scheduler', 'scheduler', 1,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "archived_at",
        "created_at", "updated_at"
      ) VALUES (
        ${archivedRoleId}::uuid, ${tenantAId}::uuid, 'Old Scheduler', 'old scheduler', 1,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_role_assignments" (
        "id", "tenant_id", "membership_id", "role_id", "created_at"
      ) VALUES (
        ${randomUUID()}::uuid, ${tenantAId}::uuid, ${membershipId}::uuid, ${roleId}::uuid,
        CURRENT_TIMESTAMP
      )
    `;
  });

  await assert.rejects(
    runAsTenant(
      tenantAId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_custom_role_assignments" (
          "id", "tenant_id", "membership_id", "role_id", "created_at"
        ) VALUES (
          ${randomUUID()}::uuid, ${tenantAId}::uuid, ${membershipId}::uuid, ${roleId}::uuid,
          CURRENT_TIMESTAMP
        )
      `,
    ),
  );
  await assert.rejects(
    runAsTenant(
      tenantBId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_custom_role_assignments" (
          "id", "tenant_id", "membership_id", "role_id", "created_at"
        ) VALUES (
          ${randomUUID()}::uuid, ${tenantBId}::uuid, ${membershipId}::uuid, ${roleId}::uuid,
          CURRENT_TIMESTAMP
        )
      `,
    ),
  );
  await assert.rejects(
    runAsTenant(
      tenantAId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_custom_role_assignments" (
          "id", "tenant_id", "membership_id", "role_id", "created_at"
        ) VALUES (
          ${randomUUID()}::uuid, ${tenantAId}::uuid, ${membershipId}::uuid, ${archivedRoleId}::uuid,
          CURRENT_TIMESTAMP
        )
      `,
    ),
  );
});
