import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantMembership } from "../../../../memberships/domain/tenant-membership.js";
import {
  TenantCustomRoleArchivedError,
  TenantCustomRoleVersionConflictError,
  TenantRbacError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { ArchiveTenantCustomRoleUseCase } from "./archive-tenant-custom-role.use-case.js";
import {
  adminAuthorization,
  customRole,
  NOW,
  ownerAuthorization,
  RecordingTenantTransactions,
  ROLE_ID,
  TENANT_ID,
  USER_ID,
} from "./tenant-rbac-use-case.test-fixtures.js";

const HOLDER_A = "550e8400-e29b-41d4-a716-446655440110";
const HOLDER_B = "550e8400-e29b-41d4-a716-446655440111";
const HOLDER_SUSPENDED = "550e8400-e29b-41d4-a716-446655440112";

function task5OwnerAuthorization(): AuthorizationContext {
  const base = ownerAuthorization();
  return Object.freeze({
    ...base,
    permissionKeys: Object.freeze([
      ...new Set([...base.permissionKeys, PERMISSION_KEYS.tenantRbacRoleArchive]),
    ]),
  });
}

function task5AdminAuthorization(): AuthorizationContext {
  const base = adminAuthorization();
  return Object.freeze({
    ...base,
    permissionKeys: Object.freeze([
      ...new Set([...base.permissionKeys, PERMISSION_KEYS.tenantRbacRoleArchive]),
    ]),
  });
}

function membership(id: string, status: "active" | "suspended"): TenantMembership {
  return Object.freeze({
    id,
    tenantId: TENANT_ID,
    userId: USER_ID,
    status,
    authorizationVersion: 5,
    acceptedAt: NOW,
    suspendedAt: status === "suspended" ? NOW : null,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function createHarness(options: {
  readonly current?: ReturnType<typeof customRole>;
  readonly affectedMembershipIds?: readonly string[];
} = {}) {
  const current = options.current ?? customRole();
  const affectedMembershipIds = options.affectedMembershipIds ?? [
    HOLDER_B,
    HOLDER_SUSPENDED,
    HOLDER_A,
  ];
  const events: string[] = [];
  const audits: Array<{ readonly eventType: string; readonly metadata: Readonly<Record<string, unknown>> }> = [];

  const transactions = new RecordingTenantTransactions({
    customRoles: {
      async lockById(roleId: string) {
        events.push(`role.lock:${roleId}`);
        return current;
      },
      async archive(roleId: string) {
        events.push(`role.archive:${roleId}`);
        return customRole({ ...current, version: current.version + 1, archivedAt: NOW });
      },
    } as never,
    customRoleAssignments: {
      async revokeAllForRole(roleId: string) {
        events.push(`assignments.revoke:${roleId}`);
        return affectedMembershipIds;
      },
    } as never,
    memberships: {
      async lockById(membershipId: string) {
        events.push(`membership.lock:${membershipId}`);
        return membership(
          membershipId,
          membershipId === HOLDER_SUSPENDED ? "suspended" : "active",
        );
      },
      async incrementAuthorizationVersion(membershipId: string) {
        events.push(`membership.bump:${membershipId}`);
        return 6;
      },
    } as never,
    audit: {
      async append(input: {
        readonly eventType: string;
        readonly metadata: Readonly<Record<string, unknown>>;
      }) {
        audits.push(input);
        events.push(`audit:${input.eventType}`);
      },
    } as never,
  });

  return { affectedMembershipIds, audits, current, events, transactions };
}

test("archive revokes active assignments, bumps role once, and invalidates only active memberships in UUID order", async () => {
  const { audits, events, transactions } = createHarness();
  const useCase = new ArchiveTenantCustomRoleUseCase(transactions);

  const result = await useCase.execute({
    authorization: task5OwnerAuthorization(),
    roleId: ROLE_ID,
    expectedVersion: 3,
    requestId: "req-archive-role",
    now: NOW,
  });

  assert.equal(result.version, 4);
  assert.equal(result.archivedAt?.toISOString(), NOW.toISOString());
  assert.deepEqual(events, [
    `role.lock:${ROLE_ID}`,
    `role.archive:${ROLE_ID}`,
    `assignments.revoke:${ROLE_ID}`,
    `membership.lock:${HOLDER_A}`,
    `membership.bump:${HOLDER_A}`,
    `membership.lock:${HOLDER_B}`,
    `membership.bump:${HOLDER_B}`,
    `membership.lock:${HOLDER_SUSPENDED}`,
    "audit:tenant.rbac.role.archived",
  ]);
  assert.equal(audits.length, 1);
  assert.deepEqual(audits[0], {
    eventType: "tenant.rbac.role.archived",
    metadata: {
      roleId: ROLE_ID,
      previousRoleVersion: 3,
      roleVersion: 4,
      revokedAssignmentCount: 3,
      invalidatedMembershipCount: 2,
    },
  });
});

test("stale expectedVersion changes no archive, assignment, membership, or audit state", async () => {
  const { events, transactions } = createHarness({ current: customRole({ version: 4 }) });
  await assert.rejects(
    new ArchiveTenantCustomRoleUseCase(transactions).execute({
      authorization: task5OwnerAuthorization(),
      roleId: ROLE_ID,
      expectedVersion: 3,
      requestId: "req-stale-archive",
      now: NOW,
    }),
    TenantCustomRoleVersionConflictError,
  );
  assert.deepEqual(events, [`role.lock:${ROLE_ID}`]);
});

test("already archived role rejects without another version or authority change", async () => {
  const { events, transactions } = createHarness({ current: customRole({ archivedAt: NOW }) });
  await assert.rejects(
    new ArchiveTenantCustomRoleUseCase(transactions).execute({
      authorization: task5OwnerAuthorization(),
      roleId: ROLE_ID,
      expectedVersion: 3,
      requestId: "req-already-archived",
      now: NOW,
    }),
    TenantCustomRoleArchivedError,
  );
  assert.deepEqual(events, [`role.lock:${ROLE_ID}`]);
});

test("tenant admin cannot archive even when archive permission is injected", async () => {
  const { events, transactions } = createHarness();
  await assert.rejects(
    new ArchiveTenantCustomRoleUseCase(transactions).execute({
      authorization: task5AdminAuthorization(),
      roleId: ROLE_ID,
      expectedVersion: 3,
      requestId: "req-admin-archive",
      now: NOW,
    }),
    TenantRbacError,
  );
  assert.deepEqual(events, []);
  assert.equal(transactions.contexts.length, 0);
});
