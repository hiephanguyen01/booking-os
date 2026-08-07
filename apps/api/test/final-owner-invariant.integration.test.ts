import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const createdTenantIds: string[] = [];
const createdUserIds: string[] = [];

async function runAsTenant<T>(
  client: PrismaClient,
  tenantId: string,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return client.$transaction(async (transaction) => {
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

async function createProvisioningTenant(): Promise<string> {
  const tenantId = randomUUID();
  const slug = `owner-invariant-${tenantId.slice(0, 8)}`;
  await prisma.$executeRaw`
    INSERT INTO "tenants" ("id", "slug", "name", "status")
    VALUES (${tenantId}::uuid, ${slug}, ${slug}, 'provisioning'::tenant_status)
  `;
  createdTenantIds.push(tenantId);
  return tenantId;
}

async function roleId(key: "tenant_owner" | "tenant_admin"): Promise<string> {
  const rows = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "roles" WHERE "key" = ${key}
  `;
  const id = rows[0]?.id;
  assert.ok(id);
  return id;
}

async function addActiveMember(
  tenantId: string,
  userId: string,
  roleKey: "tenant_owner" | "tenant_admin",
): Promise<string> {
  const assignmentId = randomUUID();
  const selectedRoleId = await roleId(roleKey);
  await runAsTenant(prisma, tenantId, async (transaction) => {
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
      INSERT INTO "role_assignments" (
        "id", "user_id", "role_id", "scope_level", "tenant_id", "created_at"
      )
      VALUES (
        ${assignmentId}::uuid, ${userId}::uuid, ${selectedRoleId}::uuid,
        'tenant'::role_scope_level, ${tenantId}::uuid, CURRENT_TIMESTAMP
      )
    `;
  });
  return assignmentId;
}

async function activateTenant(tenantId: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "tenants" SET "status" = 'active'::tenant_status WHERE "id" = ${tenantId}::uuid
  `;
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
    // RED intentionally runs before the owner invariant exists.
  } finally {
    await prisma.$disconnect();
  }
});

test("an active tenant cannot commit without an active owner", async () => {
  const tenantId = await createProvisioningTenant();
  await assert.rejects(activateTenant(tenantId));
});

test("suspending or demoting the final active owner fails at commit", async () => {
  const tenantId = await createProvisioningTenant();
  const ownerUserId = await createUser();
  const ownerAssignmentId = await addActiveMember(tenantId, ownerUserId, "tenant_owner");
  await activateTenant(tenantId);
  const adminRoleId = await roleId("tenant_admin");

  await assert.rejects(
    runAsTenant(
      prisma,
      tenantId,
      (transaction) => transaction.$executeRaw`
        UPDATE "role_assignments"
        SET "role_id" = ${adminRoleId}::uuid
        WHERE "id" = ${ownerAssignmentId}::uuid
      `,
    ),
  );

  await assert.rejects(
    runAsTenant(
      prisma,
      tenantId,
      (transaction) => transaction.$executeRaw`
        UPDATE "tenant_memberships"
        SET "status" = 'suspended'::tenant_membership_status,
            "suspended_at" = CURRENT_TIMESTAMP,
            "updated_at" = CURRENT_TIMESTAMP
        WHERE "tenant_id" = ${tenantId}::uuid
          AND "user_id" = ${ownerUserId}::uuid
      `,
    ),
  );
});

test("owner replacement succeeds when promotion and demotion commit atomically", async () => {
  const tenantId = await createProvisioningTenant();
  const ownerUserId = await createUser();
  const adminUserId = await createUser();
  const ownerAssignmentId = await addActiveMember(tenantId, ownerUserId, "tenant_owner");
  const adminAssignmentId = await addActiveMember(tenantId, adminUserId, "tenant_admin");
  await activateTenant(tenantId);
  const ownerRoleId = await roleId("tenant_owner");
  const adminRoleId = await roleId("tenant_admin");

  await runAsTenant(prisma, tenantId, async (transaction) => {
    await transaction.$executeRaw`
      UPDATE "role_assignments"
      SET "role_id" = ${ownerRoleId}::uuid
      WHERE "id" = ${adminAssignmentId}::uuid
    `;
    await transaction.$executeRaw`
      UPDATE "role_assignments"
      SET "role_id" = ${adminRoleId}::uuid
      WHERE "id" = ${ownerAssignmentId}::uuid
    `;
  });

  const owners = await runAsTenant(
    prisma,
    tenantId,
    (transaction) => transaction.$queryRaw<readonly { user_id: string }[]>`
      SELECT assignment."user_id"
      FROM "role_assignments" assignment
      INNER JOIN "roles" role ON role."id" = assignment."role_id"
      INNER JOIN "tenant_memberships" membership
        ON membership."tenant_id" = assignment."tenant_id"
       AND membership."user_id" = assignment."user_id"
      WHERE assignment."tenant_id" = ${tenantId}::uuid
        AND assignment."revoked_at" IS NULL
        AND membership."status" = 'active'::tenant_membership_status
        AND role."key" = 'tenant_owner'
    `,
  );
  assert.deepEqual(owners, [{ user_id: adminUserId }]);
});

test("concurrent owner demotions allow one winner and preserve one active owner", async () => {
  const tenantId = await createProvisioningTenant();
  const firstOwnerUserId = await createUser();
  const secondOwnerUserId = await createUser();
  const firstAssignmentId = await addActiveMember(tenantId, firstOwnerUserId, "tenant_owner");
  const secondAssignmentId = await addActiveMember(tenantId, secondOwnerUserId, "tenant_owner");
  await activateTenant(tenantId);
  const adminRoleId = await roleId("tenant_admin");
  const firstClient = new PrismaClient();
  const secondClient = new PrismaClient();

  let readyCount = 0;
  let releaseBoth!: () => void;
  const bothReady = new Promise<void>((resolve) => {
    releaseBoth = resolve;
  });

  const demote = async (client: PrismaClient, assignmentId: string): Promise<void> => {
    await runAsTenant(client, tenantId, async (transaction) => {
      await transaction.$executeRaw`
        UPDATE "role_assignments"
        SET "role_id" = ${adminRoleId}::uuid
        WHERE "id" = ${assignmentId}::uuid
      `;
      readyCount += 1;
      if (readyCount === 2) {
        releaseBoth();
      }
      await bothReady;
    });
  };

  try {
    const results = await Promise.allSettled([
      demote(firstClient, firstAssignmentId),
      demote(secondClient, secondAssignmentId),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  } finally {
    await firstClient.$disconnect();
    await secondClient.$disconnect();
  }

  const ownerCount = await runAsTenant(prisma, tenantId, async (transaction) => {
    const rows = await transaction.$queryRaw<readonly { count: bigint }[]>`
        SELECT COUNT(*) AS count
        FROM "role_assignments" assignment
        INNER JOIN "roles" role ON role."id" = assignment."role_id"
        INNER JOIN "tenant_memberships" membership
          ON membership."tenant_id" = assignment."tenant_id"
         AND membership."user_id" = assignment."user_id"
        WHERE assignment."tenant_id" = ${tenantId}::uuid
          AND assignment."revoked_at" IS NULL
          AND membership."status" = 'active'::tenant_membership_status
          AND role."key" = 'tenant_owner'
    `;
    return Number(rows[0]?.count ?? 0n);
  });
  assert.equal(ownerCount, 1);
});
