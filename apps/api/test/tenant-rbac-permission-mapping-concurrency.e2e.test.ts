import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before, beforeEach } from "node:test";

import { PERMISSION_KEYS, SYSTEM_ROLES, type PermissionKey } from "@booking-os/auth";
import { type Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_ID = "b1100000-0000-4000-8000-000000000001";
const OWNER_USER_ID = "b2100000-0000-4000-8000-000000000001";
const OWNER_MEMBERSHIP_ID = "b3100000-0000-4000-8000-000000000001";
const ROLE_ID = "b4100000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-21T07:40:00.000Z");

let permissionId: string;

async function seededPermissionId(key: PermissionKey): Promise<string> {
  const rows = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "permissions" WHERE "key" = ${key}
  `;
  const id = rows[0]?.id;
  assert.ok(id, `permission seed must exist for ${key}`);
  return id;
}

async function resetRoleState(): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "tenant_custom_roles" WHERE "tenant_id" = ${TENANT_ID}::uuid
  `;
  await prisma.$executeRaw`
    INSERT INTO "tenant_custom_roles" (
      "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
    ) VALUES (
      ${ROLE_ID}::uuid,
      ${TENANT_ID}::uuid,
      'Permission Race Role',
      'permission race role',
      1,
      ${NOW}::timestamptz,
      ${NOW}::timestamptz
    )
  `;
}

before(async () => {
  await prisma.$connect();
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma.user.deleteMany({ where: { id: OWNER_USER_ID } });
  permissionId = await seededPermissionId(PERMISSION_KEYS.tenantMembershipRead);
  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { key: SYSTEM_ROLES.tenantOwner },
  });
  await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      slug: "rbac-permission-mapping-concurrency",
      name: "RBAC Permission Mapping Concurrency",
      status: "provisioning",
    },
  });
  await prisma.user.create({
    data: {
      id: OWNER_USER_ID,
      normalizedEmail: "rbac-permission-mapping-concurrency-owner@example.test",
      displayEmail: "rbac-permission-mapping-concurrency-owner@example.test",
      status: "active",
      authorizationVersion: 1,
      activatedAt: NOW,
    },
  });
  await prisma.tenantMembership.create({
    data: {
      id: OWNER_MEMBERSHIP_ID,
      tenantId: TENANT_ID,
      userId: OWNER_USER_ID,
      status: "active",
      authorizationVersion: 1,
      acceptedAt: NOW,
    },
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
});

beforeEach(resetRoleState);

after(async () => {
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma.user.deleteMany({ where: { id: OWNER_USER_ID } });
  await prisma.$disconnect();
});

test("archive racing direct permission mapping cannot leave a mapping on the archived role", async () => {
  let markArchiveReady!: () => void;
  let releaseArchive!: () => void;
  const archiveReady = new Promise<void>((resolve) => {
    markArchiveReady = resolve;
  });
  const archiveReleased = new Promise<void>((resolve) => {
    releaseArchive = resolve;
  });

  const archivePromise = prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
    const roleRows = await transaction.$queryRaw<readonly { id: string }[]>`
      SELECT "id"
      FROM "tenant_custom_roles"
      WHERE "tenant_id" = ${TENANT_ID}::uuid AND "id" = ${ROLE_ID}::uuid
      FOR UPDATE
    `;
    assert.equal(roleRows[0]?.id, ROLE_ID);
    await transaction.$executeRaw`
      UPDATE "tenant_custom_roles"
      SET "archived_at" = ${NOW}::timestamptz,
          "version" = "version" + 1,
          "updated_at" = ${NOW}::timestamptz
      WHERE "tenant_id" = ${TENANT_ID}::uuid AND "id" = ${ROLE_ID}::uuid
    `;
    markArchiveReady();
    await archiveReleased;
  });

  await archiveReady;

  let markInsertPid!: (pid: number) => void;
  const insertPid = new Promise<number>((resolve) => {
    markInsertPid = resolve;
  });
  const insertPromise = prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
    await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
    await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT_ID}, true)`;
    const pidRows = await transaction.$queryRaw<readonly { pid: number }[]>`
      SELECT pg_backend_pid()::int AS "pid"
    `;
    const pid = pidRows[0]?.pid;
    assert.ok(pid);
    markInsertPid(pid);
    return transaction.$executeRaw`
      INSERT INTO "tenant_custom_role_permissions" (
        "tenant_id", "role_id", "permission_id", "created_at"
      ) VALUES (
        ${TENANT_ID}::uuid,
        ${ROLE_ID}::uuid,
        ${permissionId}::uuid,
        ${NOW}::timestamptz
      )
    `;
  });

  const pid = await insertPid;
  let observedBlockedInsert = false;
  try {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const rows = await prisma.$queryRaw<
        readonly { query: string; state: string; waitEventType: string | null }[]
      >`
        SELECT "query", "state", "wait_event_type" AS "waitEventType"
        FROM pg_stat_activity
        WHERE "pid" = ${pid}
      `;
      const activity = rows[0];
      if (
        activity?.state === "active" &&
        activity.waitEventType === "Lock" &&
        activity.query.includes('INSERT INTO "tenant_custom_role_permissions"')
      ) {
        observedBlockedInsert = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(
      observedBlockedInsert,
      true,
      "permission write must reach the blocked mapping INSERT",
    );
  } finally {
    releaseArchive();
  }

  const [archiveResult, insertResult] = await Promise.allSettled([archivePromise, insertPromise]);
  assert.equal(archiveResult.status, "fulfilled");
  assert.equal(insertResult.status, "rejected");

  const roles = await prisma.$queryRaw<readonly { archivedAt: Date | null }[]>`
    SELECT "archived_at" AS "archivedAt"
    FROM "tenant_custom_roles"
    WHERE "tenant_id" = ${TENANT_ID}::uuid AND "id" = ${ROLE_ID}::uuid
  `;
  const mappings = await prisma.$queryRaw<readonly { count: bigint }[]>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "tenant_custom_role_permissions"
    WHERE "tenant_id" = ${TENANT_ID}::uuid
      AND "role_id" = ${ROLE_ID}::uuid
      AND "permission_id" = ${permissionId}::uuid
  `;
  assert.ok(roles[0]?.archivedAt);
  assert.equal(Number(mappings[0]?.count ?? 0n), 0);
});
