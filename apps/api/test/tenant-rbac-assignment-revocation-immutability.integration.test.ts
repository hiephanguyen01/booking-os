import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { type Prisma, PrismaClient } from "@prisma/client";

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
  const slug = `rbac-assignment-revocation-${tenantId.slice(0, 8)}`;
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
  } finally {
    await prisma.$disconnect();
  }
});

test("booking_app cannot reactivate a revoked tenant custom-role assignment", async () => {
  const tenantId = await createTenant();
  const membershipId = await createActiveMembership(tenantId);
  const roleId = randomUUID();
  const assignmentId = randomUUID();

  await runAsTenant(tenantId, async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES (
        ${roleId}::uuid, ${tenantId}::uuid, 'Revocation History Role',
        'revocation history role', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_role_assignments" (
        "id", "tenant_id", "membership_id", "role_id", "created_at"
      ) VALUES (
        ${assignmentId}::uuid, ${tenantId}::uuid, ${membershipId}::uuid, ${roleId}::uuid,
        CURRENT_TIMESTAMP
      )
    `;
    const revoked = await transaction.$executeRaw`
      UPDATE "tenant_custom_role_assignments"
      SET "revoked_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${assignmentId}::uuid AND "revoked_at" IS NULL
    `;
    assert.equal(revoked, 1);
  });

  await assert.rejects(
    runAsTenant(
      tenantId,
      (transaction) => transaction.$executeRaw`
        UPDATE "tenant_custom_role_assignments"
        SET "revoked_at" = NULL
        WHERE "id" = ${assignmentId}::uuid
      `,
    ),
    /revoked tenant custom role assignment cannot be reactivated/i,
  );

  const rows = await runAsTenant(
    tenantId,
    (transaction) => transaction.$queryRaw<readonly { revokedAt: Date | null }[]>`
      SELECT "revoked_at" AS "revokedAt"
      FROM "tenant_custom_role_assignments"
      WHERE "id" = ${assignmentId}::uuid
    `,
  );
  assert.ok(rows[0]?.revokedAt);
});
