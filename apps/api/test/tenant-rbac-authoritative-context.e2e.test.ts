import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { SYSTEM_ROLES } from "@booking-os/auth";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_ID = "d1000000-0000-4000-8000-000000000001";
const OWNER_USER_ID = "d2000000-0000-4000-8000-000000000001";
const TARGET_USER_ID = "d2000000-0000-4000-8000-000000000002";
const OWNER_MEMBERSHIP_ID = "d3000000-0000-4000-8000-000000000001";
const TARGET_MEMBERSHIP_ID = "d3000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-08-18T08:00:00.000Z");

class RollbackAuthoritativeContextTest extends Error {}

async function cleanup(): Promise<void> {
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [OWNER_USER_ID, TARGET_USER_ID] } } });
}

before(async () => {
  await prisma.$connect();
  await cleanup();

  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { key: SYSTEM_ROLES.tenantOwner },
  });
  const tenantAdminRole = await prisma.role.findUniqueOrThrow({
    where: { key: SYSTEM_ROLES.tenantAdmin },
  });

  await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      slug: "rbac-authoritative-context",
      name: "RBAC Authoritative Context",
      status: "provisioning",
    },
  });
  await prisma.user.createMany({
    data: [
      {
        id: OWNER_USER_ID,
        normalizedEmail: "rbac-authoritative-context-owner@example.test",
        displayEmail: "rbac-authoritative-context-owner@example.test",
        status: "active",
        authorizationVersion: 1,
        activatedAt: NOW,
      },
      {
        id: TARGET_USER_ID,
        normalizedEmail: "rbac-authoritative-context-target@example.test",
        displayEmail: "rbac-authoritative-context-target@example.test",
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
  await prisma.tenant.update({
    where: { id: TENANT_ID },
    data: { status: "active" },
  });
  await prisma.roleAssignment.create({
    data: {
      id: randomUUID(),
      userId: TARGET_USER_ID,
      roleId: tenantAdminRole.id,
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
