import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../tenancy/application/ports/tenant-transaction.port.js";
import { RoleGrantNotAllowedError } from "../../domain/membership-errors.js";
import type { TenantMembership } from "../../domain/tenant-membership.js";
import { SuspendMembershipUseCase } from "./suspend-membership.use-case.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const TARGET_ID = "10000000-0000-4000-8000-000000000002";
const MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-08-09T01:00:00.000Z");

const authorization: AuthorizationContext = {
  userId: ACTOR_ID,
  sessionId: "60000000-0000-4000-8000-000000000001",
  scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" },
  membershipId: "40000000-0000-4000-8000-000000000001",
  membershipStatus: "active",
  roleKeys: [SYSTEM_ROLES.tenantOwner],
  permissionKeys: [PERMISSION_KEYS.tenantMembershipAdminSuspend],
  userAuthorizationVersion: 1,
  membershipAuthorizationVersion: 1,
};

const activeAdmin: TenantMembership = Object.freeze({
  id: MEMBERSHIP_ID,
  tenantId: TENANT_ID,
  userId: TARGET_ID,
  status: "active",
  authorizationVersion: 4,
  acceptedAt: new Date("2026-08-08T10:00:00.000Z"),
  suspendedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-08-08T09:00:00.000Z"),
  updatedAt: new Date("2026-08-08T10:00:00.000Z"),
});

function createTransactions(events: string[]): TenantTransactionPort {
  return {
    async run(context, work) {
      assert.equal(context.tenantId, TENANT_ID);
      assert.equal(context.actorId, ACTOR_ID);
      assert.equal(context.requestId, "request-suspend");
      return work({
        memberships: {
          lockById: async (id: string) => {
            assert.equal(id, MEMBERSHIP_ID);
            events.push("membership.lock");
            return activeAdmin;
          },
          suspend: async (id: string, now: Date) => {
            assert.equal(id, MEMBERSHIP_ID);
            assert.equal(now, NOW);
            events.push("membership.suspend");
            return {
              ...activeAdmin,
              status: "suspended",
              authorizationVersion: 5,
              suspendedAt: NOW,
            };
          },
        },
        roles: {
          listActiveRoleKeys: async (userId: string) => {
            assert.equal(userId, TARGET_ID);
            events.push("role.list");
            return [SYSTEM_ROLES.tenantAdmin];
          },
        },
        sessions: {
          revokeTenantSessionsForUser: async (input: unknown) => {
            assert.deepEqual(input, {
              tenantId: TENANT_ID,
              userId: TARGET_ID,
              revokedAt: NOW,
              reason: "membership_suspended",
            });
            events.push("session.revoke");
            return 2;
          },
        },
        audit: {
          append: async (input: unknown) => {
            assert.deepEqual(input, {
              eventType: "membership.suspended",
              actorUserId: ACTOR_ID,
              subjectUserId: TARGET_ID,
              requestId: "request-suspend",
              metadata: {
                membershipId: MEMBERSHIP_ID,
                authorizationVersion: 5,
                revokedSessionCount: 2,
              },
              occurredAt: NOW,
            });
            events.push("audit.append");
          },
        },
      } as never);
    },
  };
}

test("suspends an active admin and revokes only that tenant's sessions", async () => {
  const events: string[] = [];
  const useCase = new SuspendMembershipUseCase(createTransactions(events), () => NOW);

  const result = await useCase.execute({
    authorization,
    membershipId: MEMBERSHIP_ID,
    requestId: "request-suspend",
  });

  assert.deepEqual(events, [
    "membership.lock",
    "role.list",
    "membership.suspend",
    "session.revoke",
    "audit.append",
  ]);
  assert.deepEqual(result, {
    membershipId: MEMBERSHIP_ID,
    status: "suspended",
    authorizationVersion: 5,
    revokedSessionCount: 2,
  });
});

test("rejects self-suspension before entering the tenant transaction", async () => {
  let entered = false;
  const transactions: TenantTransactionPort = {
    async run(_context, _work) {
      entered = true;
      throw new Error("unreachable");
    },
  };
  const useCase = new SuspendMembershipUseCase(transactions, () => NOW);

  await assert.rejects(
    () =>
      useCase.execute({
        authorization,
        membershipId: authorization.membershipId as string,
        requestId: "request-self-suspend",
      }),
    RoleGrantNotAllowedError,
  );
  assert.equal(entered, false);
});
