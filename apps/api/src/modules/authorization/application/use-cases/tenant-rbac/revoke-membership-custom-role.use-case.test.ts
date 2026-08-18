import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import { MembershipRequiredError } from "../../../../memberships/domain/membership-errors.js";
import type { TenantMembership } from "../../../../memberships/domain/tenant-membership.js";
import {
  TenantCustomRoleNotFoundError,
  TenantRbacAssignmentNotAllowedError,
} from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { RevokeMembershipCustomRoleUseCase } from "./revoke-membership-custom-role.use-case.js";
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

function revokeAuthorization(base: AuthorizationContext = ownerAuthorization()): AuthorizationContext {
  return Object.freeze({
    ...base,
    permissionKeys: Object.freeze([
      ...new Set([...base.permissionKeys, PERMISSION_KEYS.tenantRbacAssignmentRevoke]),
    ]),
  });
}

function membership(): TenantMembership {
  return Object.freeze({
    id: MEMBERSHIP_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    status: "active" as const,
    authorizationVersion: 8,
    acceptedAt: NOW,
    suspendedAt: null,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function createHarness(options: {
  readonly role?: ReturnType<typeof customRole> | null;
  readonly targetMembership?: TenantMembership | null;
  readonly changed?: boolean;
} = {}) {
  const role = options.role === undefined ? customRole() : options.role;
  const targetMembership = options.targetMembership === undefined ? membership() : options.targetMembership;
  const changed = options.changed ?? true;
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
        return 9;
      },
    } as never,
    customRoleAssignments: {
      async revoke(membershipId: string, roleId: string) {
        events.push(`assignment.revoke:${membershipId}:${roleId}`);
        return changed;
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

test("first revoke locks role then membership, revokes once, invalidates authority once, and audits", async () => {
  const { audits, events, transactions } = createHarness();

  const changed = await new RevokeMembershipCustomRoleUseCase(transactions).execute({
    authorization: revokeAuthorization(),
    membershipId: MEMBERSHIP_ID,
    roleId: ROLE_ID,
    requestId: "req-revoke-assignment",
    now: NOW,
  });

  assert.equal(changed, true);
  assert.deepEqual(events, [
    `role.lock:${ROLE_ID}`,
    `membership.lock:${MEMBERSHIP_ID}`,
    `assignment.revoke:${MEMBERSHIP_ID}:${ROLE_ID}`,
    `membership.bump:${MEMBERSHIP_ID}`,
    "audit:tenant.rbac.assignment.revoked",
  ]);
  assert.deepEqual(audits, [{
    eventType: "tenant.rbac.assignment.revoked",
    metadata: { membershipId: MEMBERSHIP_ID, roleId: ROLE_ID },
  }]);
});

test("repeated revoke is a safe idempotent no-op with no second version bump or audit", async () => {
  const { audits, events, transactions } = createHarness({ changed: false });

  const changed = await new RevokeMembershipCustomRoleUseCase(transactions).execute({
    authorization: revokeAuthorization(),
    membershipId: MEMBERSHIP_ID,
    roleId: ROLE_ID,
    requestId: "req-repeat-revoke",
    now: NOW,
  });

  assert.equal(changed, false);
  assert.deepEqual(events, [
    `role.lock:${ROLE_ID}`,
    `membership.lock:${MEMBERSHIP_ID}`,
    `assignment.revoke:${MEMBERSHIP_ID}:${ROLE_ID}`,
  ]);
  assert.deepEqual(audits, []);
});

test("archived role remains revocable so cleanup stays idempotent", async () => {
  const { events, transactions } = createHarness({ role: customRole({ archivedAt: NOW }) });

  const changed = await new RevokeMembershipCustomRoleUseCase(transactions).execute({
    authorization: revokeAuthorization(),
    membershipId: MEMBERSHIP_ID,
    roleId: ROLE_ID,
    requestId: "req-revoke-archived-role",
    now: NOW,
  });

  assert.equal(changed, true);
  assert.equal(events[0], `role.lock:${ROLE_ID}`);
});

test("missing or foreign role/membership fails with tenant-scoped not-found semantics before revoke", async () => {
  const cases = [
    [createHarness({ role: null }), TenantCustomRoleNotFoundError],
    [createHarness({ targetMembership: null }), MembershipRequiredError],
  ] as const;

  for (const [harness, ErrorType] of cases) {
    await assert.rejects(
      new RevokeMembershipCustomRoleUseCase(harness.transactions).execute({
        authorization: revokeAuthorization(),
        membershipId: MEMBERSHIP_ID,
        roleId: ROLE_ID,
        requestId: "req-invalid-revoke",
        now: NOW,
      }),
      ErrorType,
    );
    assert.equal(harness.events.some((event) => event.startsWith("assignment.revoke:")), false);
    assert.equal(harness.events.some((event) => event.startsWith("membership.bump:")), false);
  }
});

test("tenant admin mutation is denied even when assignment revoke permission is injected", async () => {
  const { events, transactions } = createHarness();

  await assert.rejects(
    new RevokeMembershipCustomRoleUseCase(transactions).execute({
      authorization: revokeAuthorization(adminAuthorization()),
      membershipId: MEMBERSHIP_ID,
      roleId: ROLE_ID,
      requestId: "req-admin-revoke",
      now: NOW,
    }),
    TenantRbacAssignmentNotAllowedError,
  );
  assert.deepEqual(events, []);
  assert.equal(transactions.contexts.length, 0);
});
