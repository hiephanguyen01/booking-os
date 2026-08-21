import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { SYSTEM_ROLES } from "@booking-os/auth";
import type { Prisma } from "@prisma/client";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_ID = "c1100000-0000-4000-8000-000000000001";
const OWNER_USER_ID = "c2100000-0000-4000-8000-000000000001";
const TARGET_USER_ID = "c2100000-0000-4000-8000-000000000002";
const OWNER_MEMBERSHIP_ID = "c3100000-0000-4000-8000-000000000001";
const TARGET_MEMBERSHIP_ID = "c3100000-0000-4000-8000-000000000002";
const ROLE_ID = "c4100000-0000-4000-8000-000000000001";
const ASSIGNMENT_ID = "c5100000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-21T15:40:00.000Z");

async function runAsTenant<T>(
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
    await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT_ID}, true)`;
    return work(transaction);
  });
}

before(async () => {
  await prisma.$connect();
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_USER_ID, TARGET_USER_ID] } } });

  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { key: SYSTEM_ROLES.tenantOwner },
  });

  await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      slug: "rbac-assignment-identity-immutability",
      name: "RBAC Assignment Identity Immutability",
      status: "provisioning",
    },
  });
  await prisma.user.createMany({
    data: [
      {
        id: OWNER_USER_ID,
        normalizedEmail: "rbac-assignment-identity-owner@example.test",
        displayEmail: "rbac-assignment-identity-owner@example.test",
        status: "active",
        authorizationVersion: 1,
        activatedAt: NOW,
      },
      {
        id: TARGET_USER_ID,
        normalizedEmail: "rbac-assignment-identity-target@example.test",
        displayEmail: "rbac-assignment-identity-target@example.test",
        status: "active",
        authorizationVersion: 1,
        activatedAt: NOW,
      },
    ],
  });
  await prisma.tenantMembership.createMany({
    data: [
      {
        id: OWNER_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        userId: OWNER_USER_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: NOW,
      },
      {
        id: TARGET_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        userId: TARGET_USER_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: NOW,
      },
    ],
  });
  await prisma.roleAssignment.create({
    data: {
      id: randomUUID(),
      userId: OWNER_USER_ID,
      roleId: ownerRole.id,
      scopeLevel: "tenant",
      tenantId: TENANT_ID,
    },
  });
  await prisma.tenant.update({ where: { id: TENANT_ID }, data: { status: "active" } });

  await runAsTenant(async (transaction) => {
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES (
        ${ROLE_ID}::uuid,
        ${TENANT_ID}::uuid,
        'Assignment Identity Role',
        'assignment identity role',
        1,
        ${NOW}::timestamptz,
        ${NOW}::timestamptz
      )
    `;
    await transaction.$executeRaw`
      INSERT INTO "tenant_custom_role_assignments" (
        "id", "tenant_id", "membership_id", "role_id", "created_at"
      ) VALUES (
        ${ASSIGNMENT_ID}::uuid,
        ${TENANT_ID}::uuid,
        ${OWNER_MEMBERSHIP_ID}::uuid,
        ${ROLE_ID}::uuid,
        ${NOW}::timestamptz
      )
    `;
  });
});

after(async () => {
  try {
    await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_USER_ID, TARGET_USER_ID] } } });
  } finally {
    await prisma.$disconnect();
  }
});

test("active custom-role assignments reject booking_app membership retargeting", async () => {
  const updateResult = await Promise.allSettled([
    runAsTenant(
      (transaction) => transaction.$executeRaw`
        UPDATE "tenant_custom_role_assignments"
        SET "membership_id" = ${TARGET_MEMBERSHIP_ID}::uuid
        WHERE "id" = ${ASSIGNMENT_ID}::uuid
      `,
    ),
  ]);

  const assignmentState = await runAsTenant(
    (transaction) => transaction.$queryRaw<readonly { membership_id: string; role_id: string }[]>`
      SELECT "membership_id", "role_id"
      FROM "tenant_custom_role_assignments"
      WHERE "id" = ${ASSIGNMENT_ID}::uuid
    `,
  );

  assert.equal(
    updateResult[0]?.status,
    "rejected",
    "assignment identity UPDATE must be rejected",
  );
  assert.deepEqual(assignmentState, [
    { membership_id: OWNER_MEMBERSHIP_ID, role_id: ROLE_ID },
  ]);
});
