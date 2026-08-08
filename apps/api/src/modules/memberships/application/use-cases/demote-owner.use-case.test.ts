import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../tenancy/application/ports/tenant-transaction.port.js";
import { LastTenantOwnerError } from "../../domain/membership-errors.js";
import type { TenantMembership } from "../../domain/tenant-membership.js";
import { DemoteOwnerUseCase } from "./demote-owner.use-case.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_OWNER_ID = "10000000-0000-4000-8000-000000000003";
const MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-09T02:30:00.000Z");

const authorization: AuthorizationContext = {
  userId: ACTOR_ID,
  sessionId: "60000000-0000-4000-8000-000000000001",
  scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" },
  membershipId: MEMBERSHIP_ID,
  membershipStatus: "active",
  roleKeys: [SYSTEM_ROLES.tenantOwner],
  permissionKeys: [PERMISSION_KEYS.tenantMembershipOwnerDemote],
  userAuthorizationVersion: 1,
  membershipAuthorizationVersion: 20,
};

const activeOwner: TenantMembership = Object.freeze({
  id: MEMBERSHIP_ID,
  tenantId: TENANT_ID,
  userId: ACTOR_ID,
  status: "active",
  authorizationVersion: 20,
  acceptedAt: new Date("2026-08-08T10:00:00.000Z"),
  suspendedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-08-08T09:00:00.000Z"),
  updatedAt: new Date("2026-08-08T10:00:00.000Z"),
});

function createTransactions(
  events: string[],
  ownerUserIds: readonly string[],
): TenantTransactionPort {
  return {
    async run(context, work) {
      assert.equal(context.tenantId, TENANT_ID);
      assert.equal(context.actorId, ACTOR_ID);
      assert.equal(context.requestId, "request-demote-owner");
      return work({
        memberships: {
          lockById: async (id: string) => {
            assert.equal(id, MEMBERSHIP_ID);
            events.push("membership.lock");
            return activeOwner;
          },
          incrementAuthorizationVersion: async (id: string, now: Date) => {
            assert.equal(id, MEMBERSHIP_ID);
            assert.equal(now, NOW);
            events.push("membership.version");
            return 21;
          },
        },
        roles: {
          lockActiveOwnerUserIds: async () => {
            events.push("owner-set.lock");
            return ownerUserIds;
          },
          listActiveRoleKeys: async (userId: string) => {
            assert.equal(userId, ACTOR_ID);
            events.push("role.list");
            return [SYSTEM_ROLES.tenantOwner];
          },
          assign: async (input: unknown) => {
            assert.deepEqual(input, {
              userId: ACTOR_ID,
              roleKey: SYSTEM_ROLES.tenantAdmin,
              now: NOW,
            });
            events.push("role.assign-admin");
          },
          revoke: async (input: unknown) => {
            assert.deepEqual(input, {
              userId: ACTOR_ID,
              roleKey: SYSTEM_ROLES.tenantOwner,
              now: NOW,
            });
            events.push("role.revoke-owner");
          },
        },
        sessions: {
          revokeTenantSessionsForUser: async (input: unknown) => {
            assert.deepEqual(input, {
              userId: ACTOR_ID,
              revokedAt: NOW,
              reason: "membership_role_changed",
            });
            events.push("session.revoke");
            return 1;
          },
        },
        audit: {
          append: async (input: unknown) => {
            assert.deepEqual(input, {
              eventType: "membership.owner_demoted",
              actorUserId: ACTOR_ID,
              subjectUserId: ACTOR_ID,
              requestId: "request-demote-owner",
              metadata: {
                membershipId: MEMBERSHIP_ID,
                authorizationVersion: 21,
                revokedSessionCount: 1,
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

test("allows self-demotion when another active owner remains", async () => {
  const events: string[] = [];
  const useCase = new DemoteOwnerUseCase(
    createTransactions(events, [ACTOR_ID, OTHER_OWNER_ID]),
    () => NOW,
  );

  const result = await useCase.execute({
    authorization,
    membershipId: MEMBERSHIP_ID,
    requestId: "request-demote-owner",
  });

  assert.deepEqual(events, [
    "owner-set.lock",
    "membership.lock",
    "role.list",
    "role.assign-admin",
    "role.revoke-owner",
    "membership.version",
    "session.revoke",
    "audit.append",
  ]);
  assert.deepEqual(result, {
    membershipId: MEMBERSHIP_ID,
    roleKey: SYSTEM_ROLES.tenantAdmin,
    authorizationVersion: 21,
    revokedSessionCount: 1,
  });
});

test("rejects demoting the final active owner before changing roles", async () => {
  const events: string[] = [];
  const useCase = new DemoteOwnerUseCase(createTransactions(events, [ACTOR_ID]), () => NOW);

  await assert.rejects(
    () =>
      useCase.execute({
        authorization,
        membershipId: MEMBERSHIP_ID,
        requestId: "request-demote-owner",
      }),
    LastTenantOwnerError,
  );
  assert.deepEqual(events, ["owner-set.lock", "membership.lock", "role.list"]);
});
