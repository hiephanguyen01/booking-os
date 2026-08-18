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
import { GrantMembershipCustomRoleUseCase } from "../src/modules/authorization/application/use-cases/tenant-rbac/grant-membership-custom-role.use-case.js";
import { RevokeMembershipCustomRoleUseCase } from "../src/modules/authorization/application/use-cases/tenant-rbac/revoke-membership-custom-role.use-case.js";
import type {
  TenantDataSession,
  TenantTransactionPort,
} from "../src/modules/tenancy/application/ports/tenant-transaction.port.js";

const prisma = new PrismaClient();
const sessionFactory = new PrismaTenantDataSessionFactory();

const TENANT_ID = "c1000000-0000-4000-8000-000000000001";
const ACTOR_USER_ID = "c2000000-0000-4000-8000-000000000001";
const TARGET_USER_ID = "c2000000-0000-4000-8000-000000000002";
const ACTOR_MEMBERSHIP_ID = "c3000000-0000-4000-8000-000000000001";
const TARGET_MEMBERSHIP_ID = "c3000000-0000-4000-8000-000000000002";
const ROLE_ID = "c4000000-0000-4000-8000-000000000001";
const SESSION_ID = "c5000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-18T07:00:00.000Z");

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
    PERMISSION_KEYS.tenantRbacAssignmentRead,
    PERMISSION_KEYS.tenantRbacAssignmentGrant,
    PERMISSION_KEYS.tenantRbacAssignmentRevoke,
  ];
  return Object.freeze({
    userId: ACTOR_USER_ID,
    sessionId: SESSION_ID,
    scope: {
      type: "tenant" as const,
      tenantId: TENANT_ID,
      tenantSlug: "rbac-assignment-concurrency",
    },
    membershipId: ACTOR_MEMBERSHIP_ID,
    membershipStatus: "active",
    roleKeys: ["tenant_owner"] as const,
    permissionKeys,
    userAuthorizationVersion: 1,
    membershipAuthorizationVersion: 1,
  });
}

async function resetAssignmentState(): Promise<void> {
  await prisma.$executeRaw`
    DELETE FROM "tenant_security_audit_events" WHERE "tenant_id" = ${TENANT_ID}::uuid
  `;
  await prisma.$executeRaw`
    DELETE FROM "tenant_custom_roles" WHERE "tenant_id" = ${TENANT_ID}::uuid
  `;
  await prisma.tenantMembership.update({
    where: { id: TARGET_MEMBERSHIP_ID },
    data: {
      status: "active",
      authorizationVersion: 1,
      suspendedAt: null,
      revokedAt: null,
    },
  });
  await prisma.$executeRaw`
    INSERT INTO "tenant_custom_roles" (
      "id", "tenant_id", "name", "normalized_name", "version", "created_at", "updated_at"
    ) VALUES (
      ${ROLE_ID}::uuid, ${TENANT_ID}::uuid, 'Concurrent Assignee', 'concurrent assignee', 1,
      ${NOW}::timestamptz, ${NOW}::timestamptz
    )
  `;
}

async function seedActiveAssignment(): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "tenant_custom_role_assignments" (
      "id", "tenant_id", "membership_id", "role_id", "created_at"
    ) VALUES (
      ${randomUUID()}::uuid, ${TENANT_ID}::uuid, ${TARGET_MEMBERSHIP_ID}::uuid,
      ${ROLE_ID}::uuid, ${NOW}::timestamptz
    )
  `;
}

async function assignmentState(): Promise<{
  readonly activeAssignmentCount: number;
  readonly targetAuthorizationVersion: number;
  readonly grantedAuditCount: number;
  readonly revokedAuditCount: number;
}> {
  const activeAssignments = await prisma.$queryRaw<readonly { count: bigint }[]>`
    SELECT COUNT(*)::bigint AS "count"
    FROM "tenant_custom_role_assignments"
    WHERE "tenant_id" = ${TENANT_ID}::uuid
      AND "membership_id" = ${TARGET_MEMBERSHIP_ID}::uuid
      AND "role_id" = ${ROLE_ID}::uuid
      AND "revoked_at" IS NULL
  `;
  const targetMembership = await prisma.tenantMembership.findUniqueOrThrow({
    where: { id: TARGET_MEMBERSHIP_ID },
  });
  const audits = await prisma.$queryRaw<readonly { eventType: string; count: bigint }[]>`
    SELECT "event_type" AS "eventType", COUNT(*)::bigint AS "count"
    FROM "tenant_security_audit_events"
    WHERE "tenant_id" = ${TENANT_ID}::uuid
      AND "event_type" IN ('tenant.rbac.assignment.granted', 'tenant.rbac.assignment.revoked')
    GROUP BY "event_type"
  `;
  const auditCounts = new Map(audits.map((row) => [row.eventType, Number(row.count)]));
  return {
    activeAssignmentCount: Number(activeAssignments[0]?.count ?? 0n),
    targetAuthorizationVersion: targetMembership.authorizationVersion,
    grantedAuditCount: auditCounts.get("tenant.rbac.assignment.granted") ?? 0,
    revokedAuditCount: auditCounts.get("tenant.rbac.assignment.revoked") ?? 0,
  };
}

before(async () => {
  await prisma.$connect();
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [ACTOR_USER_ID, TARGET_USER_ID] } } });

  const ownerRole = await prisma.role.findUniqueOrThrow({
    where: { key: SYSTEM_ROLES.tenantOwner },
  });

  await prisma.tenant.create({
    data: {
      id: TENANT_ID,
      slug: "rbac-assignment-concurrency",
      name: "RBAC Assignment Concurrency",
      status: "provisioning",
    },
  });
  await prisma.user.createMany({
    data: [
      {
        id: ACTOR_USER_ID,
        normalizedEmail: "rbac-assignment-concurrency-owner@example.test",
        displayEmail: "rbac-assignment-concurrency-owner@example.test",
        status: "active",
        authorizationVersion: 1,
        activatedAt: NOW,
      },
      {
        id: TARGET_USER_ID,
        normalizedEmail: "rbac-assignment-concurrency-target@example.test",
        displayEmail: "rbac-assignment-concurrency-target@example.test",
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
      userId: ACTOR_USER_ID,
      roleId: ownerRole.id,
      scopeLevel: "tenant",
      tenantId: TENANT_ID,
    },
  });
  await prisma.tenant.update({ where: { id: TENANT_ID }, data: { status: "active" } });
});

beforeEach(resetAssignmentState);

after(async () => {
  await prisma.tenant.deleteMany({ where: { id: TENANT_ID } });
  await prisma.user.deleteMany({ where: { id: { in: [ACTOR_USER_ID, TARGET_USER_ID] } } });
  await prisma.$disconnect();
});

test("S2-RBAC09 concurrent duplicate grants converge to one active assignment and one authority invalidation", async () => {
  const useCase = new GrantMembershipCustomRoleUseCase(transactions);
  const input = {
    authorization: ownerAuthorization(),
    membershipId: TARGET_MEMBERSHIP_ID,
    roleId: ROLE_ID,
    requestId: "req-concurrent-grant",
    now: NOW,
  } as const;

  const results = await Promise.allSettled([useCase.execute(input), useCase.execute(input)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
  const assignmentIds = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value.id] : [],
  );
  assert.equal(new Set(assignmentIds).size, 1);

  const state = await assignmentState();
  assert.equal(state.activeAssignmentCount, 1);
  assert.equal(state.targetAuthorizationVersion, 2);
  assert.equal(state.grantedAuditCount, 1);
  assert.equal(state.revokedAuditCount, 0);
});

test("S2-RBAC10 concurrent duplicate revokes converge to one revoke and one authority invalidation", async () => {
  await seedActiveAssignment();
  const useCase = new RevokeMembershipCustomRoleUseCase(transactions);
  const input = {
    authorization: ownerAuthorization(),
    membershipId: TARGET_MEMBERSHIP_ID,
    roleId: ROLE_ID,
    requestId: "req-concurrent-revoke",
    now: NOW,
  } as const;

  const results = await Promise.allSettled([useCase.execute(input), useCase.execute(input)]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2);
  const changed = results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  assert.deepEqual([...changed].sort(), [false, true]);

  const state = await assignmentState();
  assert.equal(state.activeAssignmentCount, 0);
  assert.equal(state.targetAuthorizationVersion, 2);
  assert.equal(state.grantedAuditCount, 0);
  assert.equal(state.revokedAuditCount, 1);
});
