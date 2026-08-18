import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before, beforeEach } from "node:test";

import { PERMISSION_KEYS, type PermissionKey, SYSTEM_ROLES } from "@booking-os/auth";
import type {
  AuthorizationContext,
  AuthorizedTenantExecutionContext,
  TenantExecutionContext,
} from "@booking-os/contracts";
import { type Prisma, PrismaClient } from "@prisma/client";

import { PrismaTenantDataSessionFactory } from "../src/database/prisma-tenant-data-session.factory.js";
import { ArchiveTenantCustomRoleUseCase } from "../src/modules/authorization/application/use-cases/tenant-rbac/archive-tenant-custom-role.use-case.js";
import { ReplaceTenantCustomRolePermissionsUseCase } from "../src/modules/authorization/application/use-cases/tenant-rbac/replace-tenant-custom-role-permissions.use-case.js";
import {
  TenantCustomRoleArchivedError,
  TenantCustomRoleVersionConflictError,
} from "../src/modules/authorization/domain/tenant-rbac/tenant-rbac.errors.js";
import type {
  TenantDataSession,
  TenantTransactionPort,
} from "../src/modules/tenancy/application/ports/tenant-transaction.port.js";

const prisma = new PrismaClient();
const sessionFactory = new PrismaTenantDataSessionFactory();

const TENANT_ID = "b1000000-0000-4000-8000-000000000001";
const ACTOR_USER_ID = "b2000000-0000-4000-8000-000000000001";
const HOLDER_USER_ID = "b2000000-0000-4000-8000-000000000002";
const ACTOR_MEMBERSHIP_ID = "b3000000-0000-4000-8000-000000000001";
const HOLDER_MEMBERSHIP_ID = "b3000000-0000-4000-8000-000000000002";
const ROLE_ID = "b4000000-0000-4000-8000-000000000001";
const SESSION_ID = "b5000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-18T05:45:00.000Z");

let membershipReadPermissionId: string;
let sessionReadPermissionId: string;

class DatabaseTenantTransactions implements TenantTransactionPort {
  async run<T>(
    context: TenantExecutionContext | AuthorizedTenantExecutionContext,
    work: (session: TenantDataSession) => Promise<T>,
  ): Promise<T> {
    return prisma.$transaction(async (transaction: Prisma.TransactionClient) => {
      await transaction.$executeRawUnsafe("SET LOCAL ROLE booking_app");
      await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${context.tenantId}, true)`;
      return work(sessionFactory.create(transaction, context.tenantId));
    });
  }
}

const transactions = new DatabaseTenantTransactions();

function ownerAuthorization(): AuthorizationContext {
  const permissionKeys: readonly PermissionKey[] = [
    PERMISSION_KEYS.tenantMembershipRead,
    PERMISSION_KEYS.tenantSecuritySessionRead,
    PERMISSION_KEYS.tenantRbacRolePermissionGrant,
    PERMISSION_KEYS.tenantRbacRolePermissionRevoke,
    PERMISSION_KEYS.tenantRbacRoleArchive,
  ];
  return Object.freeze({
    userId: ACTOR_USER_ID,
    sessionId: SESSION_ID,
    scope: { type: "tenant" as const, tenantId: TENANT_ID, tenantSlug: "rbac-role-concurrency" },
    membershipId: ACTOR_MEMBERSHIP_ID,
    membershipStatus: "active",
    roleKeys: ["tenant_owner"] as const,
    permissionKeys,
    userAuthorizationVersion: 1,
    membershipAuthorizationVersion: 1,
  });
}

async function permissionId(key: PermissionKey): Promise<string> {
  const rows = await prisma.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "permissions" WHERE "key" = ${key}
  `;
  const id = rows[0]?.id;
  assert.ok(id, `permission seed must exist for ${key}`);
  return id;
}

async function resetRoleState(): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "tenant_security_audit_events" WHERE "tenant_id" = ${TENANT_ID}::uuid
  `;
  await prisma.$executeRaw`
    DELETE FROM "tenant_custom_roles" WHERE "tenant_id" = ${TENANT_ID}::uuid
  `;
  await prisma.tenantMembership.update({
    where: { id: HOLDER_MEMBERSHIP_ID },
    data: { status: "active", authorizationVersion: 1, suspendedAt: null, revokedAt: null },
  });
  await prisma.$executeRaw`
    INSERT INTO "tenant_custom_roles" (
      "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
    ) VALUES (
      ${ROLE_ID}::uuid, ${TENANT_ID}::uuid, 'Concurrent Dispatcher', 'concurrent dispatcher', 1,
      ${NOW}::timestamptz, ${NOW}::timestamptz
    )
  `;
  await prisma.$executeRaw`
    INSERT INTO "tenant_custom_role_permissions" (
      "tenant_id", "role_id", "permission_id", "created_at"
    ) VALUES (
      ${TENANT_ID}::uuid, ${ROLE_ID}::uuid, ${membershipReadPermissionId}::uuid, ${NOW}::timestamptz
    )
  `;
  await prisma.$executeRaw`
    INSERT INTO "tenant_custom_role_assignments" (
      "id", "tenant_id", "membership_id", "role_id", "created_at"
    ) VALUES (
      ${randomUUID()}::uuid, ${TENANT_ID}::uuid, ${HOLDER_MEMBERSHIP_ID}::uuid,
      ${ROLE_ID}::uuid, ${NOW}::timestamptz
    )
  `;
}

async function roleState(): Promise<{
  readonly archivedAt: Date | null;
  readonly version: number;
  readonly permissionKeys: readonly string[];
  readonly assignmentRevokedAt: Date | null;
  readonly holderAuthorizationVersion: number;
  readonly auditEventTypes: readonly string[];
}> {
  const roles = await prisma.$queryRaw<readonly { version: number; archivedAt: Date | null }[]>`
    SELECT "version", "archived_at" AS "archivedAt"
    FROM "tenant_custom_roles"
    WHERE "tenant_id" = ${TENANT_ID}::uuid AND "id" = ${ROLE_ID}::uuid
  `;
  const mappings = await prisma.$queryRaw<readonly { key: string }[]>`
    SELECT permission."key"::text AS "key"
    FROM "tenant_custom_role_permissions" mapping
    INNER JOIN "permissions" permission ON permission."id" = mapping."permission_id"
    WHERE mapping."tenant_id" = ${TENANT_ID}::uuid AND mapping."role_id" = ${ROLE_ID}::uuid
    ORDER BY permission."key"
  `;
  const assignments = await prisma.$queryRaw<readonly { revokedAt: Date | null }[]>`
    SELECT "revoked_at" AS "revokedAt"
    FROM "tenant_custom_role_assignments"
    WHERE "tenant_id" = ${TENANT_ID}::uuid
      AND "membership_id" = ${HOLDER_MEMBERSHIP_ID}::uuid
      AND "role_id" = ${ROLE_ID}::uuid
    ORDER BY "created_at" DESC
    LIMIT 1
  `;
  const membership = await prisma.tenantMembership.findUniqueOrThrow({
    where: { id: HOLDER_MEMBERSHIP_ID },
  });
  const audits = await prisma.$queryRaw<readonly { eventType: string }[]>`
    SELECT "event_type" AS "eventType"
    FROM "tenant_security_audit_events"
    WHERE "tenant_id" = ${TENANT_ID}::uuid
      AND "event_type" IN ('tenant.rbac.role.permissions_changed', 'tenant.rbac.role.archived')
    ORDER BY "occurred_at", "event_type"
  `;
  const role = roles[0];
  const assignment = assignments[0];
  assert.ok(role);
  assert.ok(assignment);
  return {
    archivedAt: role.archivedAt,
    version: role.version,
    permissionKeys: mappings.map((mapping) => mapping.key),
    assignmentRevokedAt: assignment.revokedAt,
    holderAuthorizationVersion: membership.authorizationVersion,
    auditEventTypes: audits.map((audit) => audit.eventType),
  };
}

before(async () => {
  await prisma.$connect();
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [ACTOR_USER_ID, HOLDER_USER_ID] } } });

  membershipReadPermissionId = await permissionId(PERMISSION_KEYS.tenantMembershipRead);
  sessionReadPermissionId = await permissionId(PERMISSION_KEYS.tenantSecuritySessionRead);
  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { key: SYSTEM_ROLES.tenantOwner },
  });

  await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      slug: "rbac-role-concurrency",
      name: "RBAC Role Concurrency",
      status: "provisioning",
    },
  });
  await prisma.user.createMany({
    data: [
      {
        id: ACTOR_USER_ID,
        normalizedEmail: "rbac-role-concurrency-owner@example.test",
        displayEmail: "rbac-role-concurrency-owner@example.test",
        status: "active",
        authorizationVersion: 1,
        activatedAt: NOW,
      },
      {
        id: HOLDER_USER_ID,
        normalizedEmail: "rbac-role-concurrency-holder@example.test",
        displayEmail: "rbac-role-concurrency-holder@example.test",
        status: "active",
        authorizationVersion: 1,
        activatedAt: NOW,
      },
    ],
  });
  await prisma.tenantMembership.createMany({
    data: [
      {
        id: ACTOR_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        userId: ACTOR_USER_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: NOW,
      },
      {
        id: HOLDER_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
        userId: HOLDER_USER_ID,
        status: "active",
        authorizationVersion: 1,
        acceptedAt: NOW,
      },
    ],
  });
  await prisma.roleAssignment.create({
    data: {
      id: randomUUID(),
      userId: ACTOR_USER_ID,
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
  await prisma.user.deleteMany({ where: { id: { in: [ACTOR_USER_ID, HOLDER_USER_ID] } } });
  await prisma.$disconnect();
});

test("S2-RBAC08 concurrent permission replacements with one expectedVersion commit authority at most once", async () => {
  const useCase = new ReplaceTenantCustomRolePermissionsUseCase(transactions);
  const input = {
    authorization: ownerAuthorization(),
    roleId: ROLE_ID,
    permissionKeys: [
      PERMISSION_KEYS.tenantMembershipRead,
      PERMISSION_KEYS.tenantSecuritySessionRead,
    ],
    expectedVersion: 1,
    requestId: "req-concurrent-replace",
    now: NOW,
  } as const;

  const results = await Promise.allSettled([useCase.execute(input), useCase.execute(input)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof TenantCustomRoleVersionConflictError);

  const state = await roleState();
  assert.equal(state.version, 2);
  assert.equal(state.archivedAt, null);
  assert.deepEqual(state.permissionKeys, [
    PERMISSION_KEYS.tenantMembershipRead,
    PERMISSION_KEYS.tenantSecuritySessionRead,
  ]);
  assert.equal(state.assignmentRevokedAt, null);
  assert.equal(state.holderAuthorizationVersion, 2);
  assert.deepEqual(state.auditEventTypes, ["tenant.rbac.role.permissions_changed"]);
  assert.ok(sessionReadPermissionId);
});

test("archive racing permission replacement serializes to one valid authority state", async () => {
  const replace = new ReplaceTenantCustomRolePermissionsUseCase(transactions);
  const archive = new ArchiveTenantCustomRoleUseCase(transactions);
  const authorization = ownerAuthorization();

  const results = await Promise.allSettled([
    replace.execute({
      authorization,
      roleId: ROLE_ID,
      permissionKeys: [
        PERMISSION_KEYS.tenantMembershipRead,
        PERMISSION_KEYS.tenantSecuritySessionRead,
      ],
      expectedVersion: 1,
      requestId: "req-race-replace",
      now: NOW,
    }),
    archive.execute({
      authorization,
      roleId: ROLE_ID,
      expectedVersion: 1,
      requestId: "req-race-archive",
      now: NOW,
    }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(
    rejected.reason instanceof TenantCustomRoleVersionConflictError ||
      rejected.reason instanceof TenantCustomRoleArchivedError,
  );

  const state = await roleState();
  assert.equal(state.version, 2);
  assert.equal(state.holderAuthorizationVersion, 2);
  if (state.archivedAt) {
    assert.deepEqual(state.permissionKeys, [PERMISSION_KEYS.tenantMembershipRead]);
    assert.ok(state.assignmentRevokedAt);
    assert.deepEqual(state.auditEventTypes, ["tenant.rbac.role.archived"]);
  } else {
    assert.deepEqual(state.permissionKeys, [
      PERMISSION_KEYS.tenantMembershipRead,
      PERMISSION_KEYS.tenantSecuritySessionRead,
    ]);
    assert.equal(state.assignmentRevokedAt, null);
    assert.deepEqual(state.auditEventTypes, ["tenant.rbac.role.permissions_changed"]);
  }
});
