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
  const slug = `partner-schema-${tenantId.slice(0, 8)}`;
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

async function constraintDefinitions(tableName: string): Promise<readonly string[]> {
  const rows = await prisma.$queryRawUnsafe<readonly { definition: string }[]>(
    `SELECT pg_get_constraintdef(c.oid) AS definition
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname = $1
     ORDER BY c.conname`,
    tableName,
  );
  return rows.map((row) => row.definition.replaceAll('"', "").replace(/\s+/g, " "));
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

test("Partner authority migration creates the root, membership, assignment, and session shape", async () => {
  const expectedTables = ["partner_memberships", "partner_system_role_assignments", "partners"];
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

  const sessionColumns = await prisma.$queryRaw<readonly { column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'auth_sessions'
      AND column_name IN (
        'partner_id',
        'partner_authorization_version',
        'partner_membership_authorization_version'
      )
    ORDER BY column_name
  `;
  assert.deepEqual(
    sessionColumns.map((row) => row.column_name),
    [
      "partner_authorization_version",
      "partner_id",
      "partner_membership_authorization_version",
    ],
  );

  const partnerScopeEnums = await prisma.$queryRaw<readonly { typname: string; enumlabel: string }[]>`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname IN ('identity_scope_type', 'role_scope_level')
      AND e.enumlabel = 'partner'
    ORDER BY t.typname
  `;
  assert.deepEqual(partnerScopeEnums, [
    { typname: "identity_scope_type", enumlabel: "partner" },
    { typname: "role_scope_level", enumlabel: "partner" },
  ]);

  const roleRows = await prisma.$queryRaw<
    readonly { key: string; scope_level: string; is_system: boolean }[]
  >`
    SELECT "key", "scope_level"::text AS scope_level, "is_system"
    FROM "roles"
    WHERE "key" IN ('partner_owner', 'partner_admin')
    ORDER BY "key"
  `;
  assert.deepEqual(roleRows, [
    { key: "partner_admin", scope_level: "partner", is_system: true },
    { key: "partner_owner", scope_level: "partner", is_system: true },
  ]);
});

test("Partner persistence enforces the composite same-tenant identities required by later slices", async () => {
  const partnerConstraints = await constraintDefinitions("partners");
  assert.ok(partnerConstraints.some((definition) => definition === "UNIQUE (id, tenant_id)"));

  const membershipConstraints = await constraintDefinitions("partner_memberships");
  assert.ok(
    membershipConstraints.some((definition) =>
      definition.includes(
        "FOREIGN KEY (tenant_membership_id, tenant_id) REFERENCES tenant_memberships(id, tenant_id)",
      ),
    ),
  );
  assert.ok(
    membershipConstraints.some((definition) =>
      definition.includes("FOREIGN KEY (partner_id, tenant_id) REFERENCES partners(id, tenant_id)"),
    ),
  );
  assert.ok(
    membershipConstraints.some(
      (definition) => definition === "UNIQUE (id, partner_id, tenant_id)",
    ),
  );
  assert.ok(
    membershipConstraints.some(
      (definition) => definition === "UNIQUE (partner_id, tenant_membership_id)",
    ),
  );

  const assignmentConstraints = await constraintDefinitions("partner_system_role_assignments");
  assert.ok(
    assignmentConstraints.some((definition) =>
      definition.includes(
        "FOREIGN KEY (partner_membership_id, partner_id, tenant_id) REFERENCES partner_memberships(id, partner_id, tenant_id)",
      ),
    ),
  );
});

test("direct DML cannot cross tenants, retarget Partner identity, reactivate revoked membership, or assign a tenant role", async () => {
  const tenantAId = await createTenant();
  const tenantBId = await createTenant();
  const tenantAMembershipId = await createActiveMembership(tenantAId);
  const tenantBMembershipId = await createActiveMembership(tenantBId);
  const partnerId = randomUUID();
  const partnerMembershipId = randomUUID();
  const assignmentId = randomUUID();

  const roles = await prisma.$queryRaw<readonly { id: string; key: string }[]>`
    SELECT "id", "key"
    FROM "roles"
    WHERE "key" IN ('partner_owner', 'tenant_owner')
    ORDER BY "key"
  `;
  const partnerOwnerRoleId = roles.find((row) => row.key === "partner_owner")?.id;
  const tenantOwnerRoleId = roles.find((row) => row.key === "tenant_owner")?.id;
  assert.ok(partnerOwnerRoleId);
  assert.ok(tenantOwnerRoleId);

  await runAsTenant(tenantAId, async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "partners" ("id", "tenant_id", "type")
      VALUES (${partnerId}::uuid, ${tenantAId}::uuid, 'individual')
    `;
    await transaction.$executeRaw`
      INSERT INTO "partner_memberships" (
        "id", "tenant_id", "partner_id", "tenant_membership_id"
      )
      VALUES (
        ${partnerMembershipId}::uuid, ${tenantAId}::uuid,
        ${partnerId}::uuid, ${tenantAMembershipId}::uuid
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "partner_system_role_assignments" (
        "id", "tenant_id", "partner_id", "partner_membership_id", "role_id"
      )
      VALUES (
        ${assignmentId}::uuid, ${tenantAId}::uuid, ${partnerId}::uuid,
        ${partnerMembershipId}::uuid, ${partnerOwnerRoleId}::uuid
      )
    `;
  });

  await assert.rejects(
    runAsTenant(
      tenantAId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "partner_memberships" (
          "id", "tenant_id", "partner_id", "tenant_membership_id"
        )
        VALUES (
          ${randomUUID()}::uuid, ${tenantAId}::uuid,
          ${partnerId}::uuid, ${tenantBMembershipId}::uuid
        )
      `,
    ),
  );

  await assert.rejects(
    runAsTenant(
      tenantAId,
      (transaction) => transaction.$executeRaw`
        UPDATE "partners"
        SET "tenant_id" = ${tenantBId}::uuid
        WHERE "id" = ${partnerId}::uuid
      `,
    ),
  );

  await runAsTenant(
    tenantAId,
    (transaction) => transaction.$executeRaw`
      UPDATE "partner_memberships"
      SET "status" = 'revoked', "revoked_at" = CURRENT_TIMESTAMP
      WHERE "id" = ${partnerMembershipId}::uuid
    `,
  );
  await assert.rejects(
    runAsTenant(
      tenantAId,
      (transaction) => transaction.$executeRaw`
        UPDATE "partner_memberships"
        SET "status" = 'active', "revoked_at" = NULL
        WHERE "id" = ${partnerMembershipId}::uuid
      `,
    ),
  );

  await assert.rejects(
    runAsTenant(
      tenantAId,
      (transaction) => transaction.$executeRaw`
        INSERT INTO "partner_system_role_assignments" (
          "id", "tenant_id", "partner_id", "partner_membership_id", "role_id"
        )
        VALUES (
          ${randomUUID()}::uuid, ${tenantAId}::uuid, ${partnerId}::uuid,
          ${partnerMembershipId}::uuid, ${tenantOwnerRoleId}::uuid
        )
      `,
    ),
  );
});
