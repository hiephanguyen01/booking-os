import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";
import { type Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TENANT_ID = "d1000000-0000-4000-8000-000000000001";
const USER_ID = "d2000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "d3000000-0000-4000-8000-000000000001";
const CUSTOM_ROLE_ID = "d4000000-0000-4000-8000-000000000001";
const ASSIGNMENT_ID = "d5000000-0000-4000-8000-000000000001";
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

test("S2-RBAC13 custom-role authority setup is valid before role switching", async () => {
  const tenantAdmin = await prisma.role.findUniqueOrThrow({
    where: { key: SYSTEM_ROLES.tenantAdmin },
  });
  const permission = await prisma.permission.findUniqueOrThrow({
    where: { key: PERMISSION_KEYS.tenantMembershipRead },
  });

  await assert.rejects(
    prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      await transaction.rolePermission.delete({
        where: {
          roleId_permissionId: {
            roleId: tenantAdmin.id,
            permissionId: permission.id,
          },
        },
      });
      await transaction.$executeRaw`
        INSERT INTO "tenant_custom_roles" (
          "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
        ) VALUES (
          ${CUSTOM_ROLE_ID}::uuid, ${TENANT_ID}::uuid, 'Membership Reader', 'membership reader', 1,
          ${NOW}::timestamptz, ${NOW}::timestamptz
        )
      `;
      await transaction.$executeRaw`
        INSERT INTO "tenant_custom_role_permissions" (
          "tenant_id", "role_id", "permission_id", "created_at"
        ) VALUES (
          ${TENANT_ID}::uuid, ${CUSTOM_ROLE_ID}::uuid, ${permission.id}::uuid, ${NOW}::timestamptz
        )
      `;
      await transaction.$executeRaw`
        INSERT INTO "tenant_custom_role_assignments" (
          "id", "tenant_id", "membership_id", "role_id", "created_at"
        ) VALUES (
          ${ASSIGNMENT_ID}::uuid, ${TENANT_ID}::uuid, ${MEMBERSHIP_ID}::uuid,
          ${CUSTOM_ROLE_ID}::uuid, ${NOW}::timestamptz
        )
      `;

      throw new RollbackAuthoritativeContextTest();
    }),
    RollbackAuthoritativeContextTest,
  );
});
