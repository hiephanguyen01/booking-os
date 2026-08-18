import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_ID = "d1000000-0000-4000-8000-000000000001";
const USER_ID = "d2000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "d3000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-18T08:00:00.000Z");

class RollbackAuthoritativeContextTest extends Error {}

async function cleanup(): Promise<void> {
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma.user.deleteMany({ where: { id: USER_ID } });
}

before(async () => {
  await prisma.$connect();
  await cleanup();

  const tenantAdmin = await prisma.role.findUniqueOrThrow({
    where: { key: SYSTEM_ROLES.tenantAdmin },
  });
  const permission = await prisma.permission.findUniqueOrThrow({
    where: { key: PERMISSION_KEYS.tenantMembershipRead },
  });
  await prisma.rolePermission.upsert({
    where: {
      roleId_permissionId: {
        roleId: tenantAdmin.id,
        permissionId: permission.id,
      },
    },
    update: {},
    create: { roleId: tenantAdmin.id, permissionId: permission.id },
  });

  await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      slug: "rbac-authoritative-context",
      name: "RBAC Authoritative Context",
      status: "active",
    },
  });
  await prisma.user.create({
    data: {
      id: USER_ID,
      normalizedEmail: "rbac-authoritative-context@example.test",
      displayEmail: "rbac-authoritative-context@example.test",
      status: "active",
      authorizationVersion: 1,
      activatedAt: NOW,
    },
  });
  await prisma.tenantMembership.create({
    data: {
      id: MEMBERSHIP_ID,
      tenantId: TENANT_ID,
      userId: USER_ID,
      status: "active",
      authorizationVersion: 1,
      acceptedAt: NOW,
    },
  });
  await prisma.roleAssignment.create({
    data: {
      id: randomUUID(),
      userId: USER_ID,
      roleId: tenantAdmin.id,
      scopeLevel: "tenant",
      tenantId: TENANT_ID,
    },
  });
});

after(async () => {
  await cleanup();
  await prisma.$disconnect();
});

test("S2-RBAC13 authoritative context fixture hooks are valid", async () => {
  await assert.rejects(
    prisma.$transaction(async () => {
      throw new RollbackAuthoritativeContextTest();
    }),
    RollbackAuthoritativeContextTest,
  );
});
