import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import {
  MembershipInactiveError,
  MembershipRequiredError,
} from "../../../../memberships/domain/membership-errors.js";
import type { TenantMembership } from "../../../../memberships/domain/tenant-membership.js";
import {
  TenantCustomRoleArchivedError,
  TenantCustomRoleNotFoundError,
  TenantRbacAssignmentNotAllowedError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { GrantMembershipCustomRoleUseCase } from "./grant-membership-custom-role.use-case.js";
import {
  adminAuthorization,
  customRole,
  MEMBERSHIP_ID,
  NOW,
  ownerAuthorization,
  RecordingTenantTransactions,
  ROLE_ID,
  TENANT_ID,
  USER_ID,
} from "./tenant-rbac-use-case.test-fixtures.js";

const ASSIGNMENT_ID = "550e8400-e29b-41d4-a716-446655440118";

function grantAuthorization(base: AuthorizationContext = ownerAuthorization()): AuthorizationContext {
  return Object.freeze({
    ...base,
    permissionKeys: Object.freeze([
      ...new Set([...base.permissionKeys, PERMISSION_KEYS.tenantRbacAssignmentGrant]),
    ]),
  });
}

function membership(status: "active" | "suspended" = "active"): TenantMembership {
  return Object.freeze({
    id: MEMBERSHIP_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    status,
    authorizationVersion: 4,
    acceptedAt: NOW,
    suspendedAt: status === "suspended" ? NOW : null,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function assignment() {
  return Object.freeze({
    id: ASSIGNMENT_ID,
    tenantId: TENANT_ID,
    membershipId: MEMBERSHIP_ID,
    roleId: ROLE_ID,
    createdAt: NOW,
    revokedAt: null,
  });
}

function createHarness(options: {
  readonly role?: ReturnType<typeof customRole> | null;
  readonly targetMembership?: TenantMembership | null;
  readonly existingAssignment?: ReturnType<typeof assignment> | null;
} = {}) {
  const role = options.role === undefined ? customRole() : options.role;
  const targetMembership = options.targetMembership === undefined ? membership() : options.targetMembership;
  const existingAssignment = options.existingAssignment ?? null;
  const events: string[] = [];
  const audits: Array<{ readonly eventType: string; readonly metadata: Readonly<Record<string, unknown>> }> = [];
  const transactions = new RecordingTenantTransactions({
    customRoles: {
      async lockById(id: string) {
        events.push(`role.lock:${id}`);
        return role;
      },
    } as never,
    memberships: {
      async lockById(id: string) {
        events.push(`membership.lock:${id}`);
        return targetMembership;
      },
      async incrementAuthorizationVersion(id: string) {
        events.push(`membership.bump:${id}`);
        return 5;
      },
    } as never,
    customRoleAssignments: {
      async findActive(membershipId: string, roleId: string) {
        events.push(`assignment.find:${membershipId}:${roleId}`);
        return existingAssignment;
      },
      async grant(membershipId: string, roleId: string) {
        events.push(`assignment.grant:${membershipId}:${roleId}`);
        return assignment();
      },
    } as never,
    audit: {
      async append(input: { readonly eventType: string; readonly metadata: Readonly<Record<string, unknown>> }) {
        audits.push({ eventType: input.eventType, metadata: input.metadata });
        events.push(`audit:${input.eventType}`);
      },
    } as never,
  });
  return { audits, events, transactions };
}

test("owner grant locks active role then active membership, creates once, invalidates authority once, and audits", async () => {
  const { audits, events, transactions } = createHarness();

  const result = await new GrantMembershipCustomRoleUseCase(transactions).execute({
    authorization: grantAuthorization(),
    membershipId: MEMBERSHIP_ID,
    roleId: ROLE_ID,
    requestId: "req-grant-assignment",
    now: NOW,
  });

  assert.deepEqual(result, assignment());
  assert.deepEqual(events, [
    `role.lock:${ROLE_ID}`,
    `membership.lock:${MEMBERSHIP_ID}`,
    `assignment.find:${MEMBERSHIP_ID}:${ROLE_ID}`,
    `assignment.grant:${MEMBERSHIP_ID}:${ROLE_ID}`,
    `membership.bump:${MEMBERSHIP_ID}`,
    "audit:tenant.rbac.assignment.granted",
  ]);
  assert.deepEqual(audits, [{
    eventType: "tenant.rbac.assignment.granted",
    metadata: { assignmentId: ASSIGNMENT_ID, membershipId: MEMBERSHIP_ID, roleId: ROLE_ID },
  }]);
});

test("duplicate grant is an idempotent no-op with no second authorization-version bump or audit", async () => {
  const existing = assignment();
  const { audits, events, transactions } = createHarness({ existingAssignment: existing });

  const result = await new GrantMembershipCustomRoleUseCase(transactions).execute({
    authorization: grantAuthorization(),
    membershipId: MEMBERSHIP_ID,
    roleId: ROLE_ID,
    requestId: "req-duplicate-grant",
    now: NOW,
  });

  assert.deepEqual(result, existing);
  assert.deepEqual(events, [
    `role.lock:${ROLE_ID}`,
    `membership.lock:${MEMBERSHIP_ID}`,
    `assignment.find:${MEMBERSHIP_ID}:${ROLE_ID}`,
  ]);
  assert.deepEqual(audits, []);
});

test("missing role, archived role, missing membership, and inactive membership fail before assignment mutation", async () => {
  const cases = [
    [createHarness({ role: null }), TenantCustomRoleNotFoundError],
    [createHarness({ role: customRole({ archivedAt: NOW }) }), TenantCustomRoleArchivedError],
    [createHarness({ targetMembership: null }), MembershipRequiredError],
    [createHarness({ targetMembership: membership("suspended") }), MembershipInactiveError],
  ] as const;

  for (const [harness, ErrorType] of cases) {
    await assert.rejects(
      new GrantMembershipCustomRoleUseCase(harness.transactions).execute({
        authorization: grantAuthorization(),
        membershipId: MEMBERSHIP_ID,
        roleId: ROLE_ID,
        requestId: "req-invalid-grant",
        now: NOW,
      }),
      ErrorType,
    );
    assert.equal(harness.events.some((event) => event.startsWith("assignment.grant:")), false);
    assert.equal(harness.events.some((event) => event.startsWith("membership.bump:")), false);
  }
});

test("tenant admin mutation is denied even when assignment grant permission is injected", async () => {
  const { events, transactions } = createHarness();

  await assert.rejects(
    new GrantMembershipCustomRoleUseCase(transactions).execute({
      authorization: grantAuthorization(adminAuthorization()),
      membershipId: MEMBERSHIP_ID,
      roleId: ROLE_ID,
      requestId: "req-admin-grant",
      now: NOW,
    }),
    TenantRbacAssignmentNotAllowedError,
  );
  assert.deepEqual(events, []);
  assert.equal(transactions.contexts.length, 0);
});
