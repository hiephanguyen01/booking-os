import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";
import { type Prisma, PrismaClient } from "@prisma/client";

import { PrismaTenantDataSessionFactory } from "../src/database/prisma-tenant-data-session.factory.js";

const prisma = new PrismaClient();
const sessionFactory = new PrismaTenantDataSessionFactory();

const TENANT_ID = "d1000000-0000-4000-8000-000000000001";
const OWNER_USER_ID = "d2000000-0000-4000-8000-000000000001";
const TARGET_USER_ID = "d2000000-0000-4000-8000-000000000002";
const OWNER_MEMBERSHIP_ID = "d3000000-0000-4000-8000-000000000001";
const TARGET_MEMBERSHIP_ID = "d3000000-0000-4000-8000-000000000002";
const ACTIVE_ROLE_ID = "d4000000-0000-4000-8000-000000000001";
const ACTIVE_ASSIGNMENT_ID = "d5000000-0000-4000-8000-000000000001";
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

test("S2-RBAC13 authoritative context includes an active custom-role permission contribution", async () => {
  const tenantAdminRole = await prisma.role.findUniqueOrThrow({
    where: { key: SYSTEM_ROLES.tenantAdmin },
  });
  const permission = await prisma.permission.findUniqueOrThrow({
    where: { key: PERMISSION_KEYS.tenantMembershipRead },
  });

  await assert.rejects(
    prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      const removedSystemPermission = await transaction.rolePermission.deleteMany({
        where: {
          roleId: tenantAdminRole.id,
          permissionId: permission.id,
        },
      });
      assert.equal(removedSystemPermission.count, 1);

      await transaction.$executeRaw`
        INSERT INTO "tenant_custom_roles" (
          "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
        ) VALUES (
          ${ACTIVE_ROLE_ID}::uuid, ${TENANT_ID}::uuid,
          'Membership Reader Active', 'membership reader active', 1,
          ${NOW}::timestamptz, ${NOW}::timestamptz
        )
      `;
      await transaction.$executeRaw`
        INSERT INTO "tenant_custom_role_permissions" (
          "tenant_id", "role_id", "permission_id", "created_at"
        ) VALUES (
          ${TENANT_ID}::uuid, ${ACTIVE_ROLE_ID}::uuid, ${permission.id}::uuid, ${NOW}::timestamptz
        )
      `;
      await transaction.$executeRaw`
        INSERT INTO "tenant_custom_role_assignments" (
          "id", "tenant_id", "membership_id", "role_id", "created_at"
        ) VALUES (
          ${ACTIVE_ASSIGNMENT_ID}::uuid, ${TENANT_ID}::uuid, ${TARGET_MEMBERSHIP_ID}::uuid,
          ${ACTIVE_ROLE_ID}::uuid, ${NOW}::timestamptz
        )
      `;

      await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
      await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${TENANT_ID}, true)`;
      const authorization = sessionFactory.create(transaction, TENANT_ID).authorization;

      const active = await authorization.loadActiveTenantAuthorization(TARGET_USER_ID);
      assert.ok(active);
      assert.equal(active.membershipId, TARGET_MEMBERSHIP_ID);
      assert.equal(active.membershipAuthorizationVersion, 1);
      assert.deepEqual(active.roleKeys, [SYSTEM_ROLES.tenantAdmin]);
      assert.ok(active.permissionKeys.includes(PERMISSION_KEYS.tenantMembershipRead));
      assert.deepEqual(active.permissionKeys, [...new Set(active.permissionKeys)].sort());

      throw new RollbackAuthoritativeContextTest();
    }),
    RollbackAuthoritativeContextTest,
  );
});
