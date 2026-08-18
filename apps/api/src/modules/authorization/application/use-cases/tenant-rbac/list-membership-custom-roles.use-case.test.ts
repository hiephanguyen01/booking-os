import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";

import { MembershipRequiredError } from "../../../../memberships/domain/membership-errors.js";
import type { TenantMembership } from "../../../../memberships/domain/tenant-membership.js";
import { TenantRbacAssignmentNotAllowedError } from "../../../domain/tenant-rbac/tenant-rbac.errors.js";
import { ListMembershipCustomRolesUseCase } from "./list-membership-custom-roles.use-case.js";
import {
  customRole,
  MEMBERSHIP_ID,
  NOW,
  ownerAuthorization,
  RecordingTenantTransactions,
  ROLE_ID,
  TENANT_ID,
  USER_ID,
} from "./tenant-rbac-use-case.test-fixtures.js";

const ROLE_ID_B = "550e8400-e29b-41d4-a716-446655440115";

function activeMembership(): TenantMembership {
  return Object.freeze({
    id: MEMBERSHIP_ID,
    tenantId: TENANT_ID,
    userId: USER_ID,
    status: "active" as const,
    authorizationVersion: 3,
    acceptedAt: NOW,
    suspendedAt: null,
    revokedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

function readableAuthorization() {
  const authorization = ownerAuthorization();
  return Object.freeze({
    ...authorization,
    permissionKeys: Object.freeze([
      ...authorization.permissionKeys,
      PERMISSION_KEYS.tenantRbacAssignmentRead,
    ]),
  });
}

test("lists active custom roles for a same-tenant membership and filters archived roles fail-closed", async () => {
  const events: string[] = [];
  const roleA = customRole();
  const roleB = customRole({ id: ROLE_ID_B, name: "Archived", normalizedName: "archived", archivedAt: NOW });
  const transactions = new RecordingTenantTransactions({
    memberships: {
      async findById(id: string) {
        events.push(`membership.find:${id}`);
        return activeMembership();
      },
    } as never,
    customRoleAssignments: {
      async listActiveForMembership(id: string) {
        events.push(`assignments.list:${id}`);
        return [
          Object.freeze({
            id: "550e8400-e29b-41d4-a716-446655440116",
            tenantId: TENANT_ID,
            membershipId: MEMBERSHIP_ID,
            roleId: ROLE_ID,
            createdAt: NOW,
            revokedAt: null,
          }),
          Object.freeze({
            id: "550e8400-e29b-41d4-a716-446655440117",
            tenantId: TENANT_ID,
            membershipId: MEMBERSHIP_ID,
            roleId: ROLE_ID_B,
            createdAt: NOW,
            revokedAt: null,
          }),
        ];
      },
    } as never,
    customRoles: {
      async findById(id: string) {
        events.push(`role.find:${id}`);
        return id === ROLE_ID ? roleA : id === ROLE_ID_B ? roleB : null;
      },
    } as never,
  });

  const result = await new ListMembershipCustomRolesUseCase(transactions).execute({
    authorization: readableAuthorization(),
    membershipId: MEMBERSHIP_ID,
  });

  assert.deepEqual(result, [roleA]);
  assert.deepEqual(events, [
    `membership.find:${MEMBERSHIP_ID}`,
    `assignments.list:${MEMBERSHIP_ID}`,
    `role.find:${ROLE_ID}`,
    `role.find:${ROLE_ID_B}`,
  ]);
});

test("missing or foreign membership uses same safe membership-not-found error", async () => {
  const transactions = new RecordingTenantTransactions({
    memberships: { async findById() { return null; } } as never,
  });

  await assert.rejects(
    new ListMembershipCustomRolesUseCase(transactions).execute({
      authorization: readableAuthorization(),
      membershipId: MEMBERSHIP_ID,
    }),
    MembershipRequiredError,
  );
});

test("assignment read permission is required before opening a tenant transaction", async () => {
  const transactions = new RecordingTenantTransactions({});

  await assert.rejects(
    new ListMembershipCustomRolesUseCase(transactions).execute({
      authorization: ownerAuthorization(),
      membershipId: MEMBERSHIP_ID,
    }),
    TenantRbacAssignmentNotAllowedError,
  );
  assert.equal(transactions.contexts.length, 0);
});
