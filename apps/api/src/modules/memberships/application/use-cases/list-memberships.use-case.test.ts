import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../../../tenancy/application/ports/tenant-transaction.port.js";
import { RoleGrantNotAllowedError } from "../../domain/membership-errors.js";
import type { TenantMembership } from "../../domain/tenant-membership.js";
import { ListMembershipsUseCase } from "./list-memberships.use-case.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const TARGET_ID = "10000000-0000-4000-8000-000000000002";
const MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000002";

const authorization: AuthorizationContext = {
  userId: ACTOR_ID,
  sessionId: "60000000-0000-4000-8000-000000000001",
  scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" },
  membershipId: "40000000-0000-4000-8000-000000000001",
  membershipStatus: "active",
  roleKeys: [SYSTEM_ROLES.tenantOwner],
  permissionKeys: [PERMISSION_KEYS.tenantMembershipRead],
  userAuthorizationVersion: 1,
  membershipAuthorizationVersion: 1,
};

const membership: TenantMembership = Object.freeze({
  id: MEMBERSHIP_ID,
  tenantId: TENANT_ID,
  userId: TARGET_ID,
  status: "active",
  authorizationVersion: 3,
  acceptedAt: new Date("2026-08-08T10:00:00.000Z"),
  suspendedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-08-08T09:00:00.000Z"),
  updatedAt: new Date("2026-08-08T10:00:00.000Z"),
});

function createTransactions(): TenantTransactionPort {
  return {
    async run(context, work) {
      assert.equal(context.tenantId, TENANT_ID);
      assert.equal(context.actorId, ACTOR_ID);
      assert.equal(context.source, "console");
      return work({
        memberships: {
          list: async () => [membership],
        },
        roles: {
          listActiveRoleKeys: async (userId: string) => {
            assert.equal(userId, TARGET_ID);
            return [SYSTEM_ROLES.tenantAdmin];
          },
        },
      } as never);
    },
  };
}

test("lists tenant-scoped memberships with active role keys", async () => {
  const useCase = new ListMembershipsUseCase(createTransactions());

  const result = await useCase.execute({ authorization, requestId: "request-list-memberships" });

  assert.deepEqual(result, [
    {
      id: MEMBERSHIP_ID,
      userId: TARGET_ID,
      status: "active",
      authorizationVersion: 3,
      roleKeys: [SYSTEM_ROLES.tenantAdmin],
    },
  ]);
});

test("rejects listing without tenant membership read permission", async () => {
  const useCase = new ListMembershipsUseCase(createTransactions());
  const denied: AuthorizationContext = { ...authorization, permissionKeys: [] };

  await assert.rejects(
    () => useCase.execute({ authorization: denied, requestId: "request-list-denied" }),
    RoleGrantNotAllowedError,
  );
});
