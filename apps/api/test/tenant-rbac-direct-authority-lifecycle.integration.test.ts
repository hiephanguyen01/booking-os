import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { SYSTEM_ROLES } from "@booking-os/auth";
import { type Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_ID = "d1100000-0000-4000-8000-000000000001";
const OWNER_USER_ID = "d2100000-0000-4000-8000-000000000001";
const TARGET_USER_ID = "d2100000-0000-4000-8000-000000000002";
const OWNER_MEMBERSHIP_ID = "d3100000-0000-4000-8000-000000000001";
const TARGET_MEMBERSHIP_ID = "d3100000-0000-4000-8000-000000000002";
const ROLE_ID = "d4100000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-21T16:50:00.000Z");

async function runAsTenant<T>(
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
    await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT_ID}, true)`;
    return work(transaction);
  });
}

async function assignmentLifecycleState(): Promise<{
  readonly authorizationVersion: number;
  readonly grantedAuditCount: number;
}> {
  const membership = await prisma.tenantMembership.findUniqueOrThrow({
    where: { id: TARGET_MEMBERSHIP_ID },
  });
  const audits = await prisma.$queryRaw<readonly { count: bigint }[]>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "tenant_security_audit_events"
    WHERE "tenant_id" = ${TENANT_ID}::uuid
      AND "event_type" = 'tenant.rbac.assignment.granted'
  `;
  return {
    authorizationVersion: membership.authorizationVersion,
    grantedAuditCount: Number(audits[0]?.count ?? 0n),
  };
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
      slug: "rbac-direct-authority-lifecycle",
      name: "RBAC Direct Authority Lifecycle",
      status: "provisioning",
    },
  });
  await prisma.user.createMany({
    data: [
      {
        id: OWNER_USER_ID,
        normalizedEmail: "rbac-direct-authority-owner@example.test",
        displayEmail: "rbac-direct-authority-owner@example.test",
        status: "active",
        authorizationVersion: 1,
        activatedAt: NOW,
      },
      {
        id: TARGET_USER_ID,
        normalizedEmail: "rbac-direct-authority-target@example.test",
        displayEmail: "rbac-direct-authority-target@example.test",
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

  await runAsTenant(
    (transaction) => transaction.$executeRaw`
      INSERT INTO "tenant_custom_roles" (
        "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
      ) VALUES (
        ${ROLE_ID}::uuid,
        ${TENANT_ID}::uuid,
        'Direct Assignment Lifecycle Role',
        'direct assignment lifecycle role',
        1,
        ${NOW}::timestamptz,
        ${NOW}::timestamptz
      )
    `,
  );
});

after(async () => {
  try {
    await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
    await prisma.user.deleteMany({ where: { id: { in: [OWNER_USER_ID, TARGET_USER_ID] } } });
  } finally {
    await prisma.$disconnect();
  }
});

test("booking_app direct assignment grant cannot change authority without lifecycle invalidation and audit", async () => {
  const beforeState = await assignmentLifecycleState();
  assert.equal(beforeState.authorizationVersion, 1);
  assert.equal(beforeState.grantedAuditCount, 0);

  let directWriteRejected = false;
  try {
    await runAsTenant(
      (transaction) => transaction.$executeRaw`
        INSERT INTO "tenant_custom_role_assignments" (
          "id", "tenant_id", "membership_id", "role_id", "created_at"
        ) VALUES (
          ${randomUUID()}::uuid,
          ${TENANT_ID}::uuid,
          ${TARGET_MEMBERSHIP_ID}::uuid,
          ${ROLE_ID}::uuid,
          ${NOW}::timestamptz
        )
      `,
    );
  } catch {
    directWriteRejected = true;
  }

  if (directWriteRejected) return;

  const afterState = await assignmentLifecycleState();
  assert.equal(
    afterState.authorizationVersion,
    beforeState.authorizationVersion + 1,
    "a direct booking_app authority grant that commits must invalidate the target membership",
  );
  assert.equal(
    afterState.grantedAuditCount,
    beforeState.grantedAuditCount + 1,
    "a direct booking_app authority grant that commits must produce the required audit event",
  );
});
