import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";
import { ConflictException } from "@nestjs/common";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import { LastTenantOwnerError } from "../../domain/membership-errors.js";
import { TenantMembershipsController } from "./tenant-memberships.controller.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const TARGET_MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000002";
const TARGET_USER_ID = "10000000-0000-4000-8000-000000000002";

const AUTHENTICATED: AuthenticatedRequestContext = {
  requestId: "request-memberships",
  traceId: "trace-memberships",
  source: "internal",
  actorId: ACTOR_ID,
  sessionId: "60000000-0000-4000-8000-000000000001",
  authScope: { type: "tenant", tenantId: TENANT_ID },
  sessionState: "active",
  authorizationVersion: 1,
};

const AUTHORIZATION: AuthorizationContext = {
  userId: ACTOR_ID,
  sessionId: AUTHENTICATED.sessionId,
  scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" },
  membershipId: "40000000-0000-4000-8000-000000000001",
  membershipStatus: "active",
  roleKeys: [SYSTEM_ROLES.tenantOwner],
  permissionKeys: [
    PERMISSION_KEYS.tenantMembershipRead,
    PERMISSION_KEYS.tenantMembershipAdminSuspend,
    PERMISSION_KEYS.tenantMembershipAdminRevoke,
    PERMISSION_KEYS.tenantMembershipOwnerPromote,
    PERMISSION_KEYS.tenantMembershipOwnerDemote,
  ],
  userAuthorizationVersion: 1,
  membershipAuthorizationVersion: 1,
};

function controllerWith(options?: { readonly demoteError?: Error }) {
  const calls: Array<readonly [string, unknown]> = [];
  const controller = new TenantMembershipsController(
    { requireAuthenticated: () => AUTHENTICATED } as never,
    {
      async execute(input: unknown) {
        calls.push(["list", input]);
        return [
          {
            id: TARGET_MEMBERSHIP_ID,
            userId: TARGET_USER_ID,
            status: "active" as const,
            authorizationVersion: 3,
            roleKeys: [SYSTEM_ROLES.tenantAdmin],
          },
        ];
      },
    } as never,
    {
      async execute(input: unknown) {
        calls.push(["suspend", input]);
        return {
          membershipId: TARGET_MEMBERSHIP_ID,
          status: "suspended" as const,
          authorizationVersion: 4,
          revokedSessionCount: 1,
        };
      },
    } as never,
    {
      async execute(input: unknown) {
        calls.push(["revoke", input]);
        return {
          membershipId: TARGET_MEMBERSHIP_ID,
          status: "revoked" as const,
          authorizationVersion: 4,
          revokedSessionCount: 1,
        };
      },
    } as never,
    {
      async execute(input: unknown) {
        calls.push(["promote", input]);
        return {
          membershipId: TARGET_MEMBERSHIP_ID,
          roleKey: SYSTEM_ROLES.tenantOwner,
          authorizationVersion: 4,
          revokedSessionCount: 1,
        };
      },
    } as never,
    {
      async execute(input: unknown) {
        calls.push(["demote", input]);
        if (options?.demoteError) throw options.demoteError;
        return {
          membershipId: TARGET_MEMBERSHIP_ID,
          roleKey: SYSTEM_ROLES.tenantAdmin,
          authorizationVersion: 4,
          revokedSessionCount: 1,
        };
      },
    } as never,
  );
  return { calls, controller };
}

test("membership routes reuse guard-built tenant authority and target membership ids", async () => {
  const { calls, controller } = controllerWith();

  assert.equal((await controller.list(AUTHORIZATION))[0]?.id, TARGET_MEMBERSHIP_ID);
  assert.equal((await controller.suspend(TARGET_MEMBERSHIP_ID, AUTHORIZATION)).status, "suspended");
  assert.equal((await controller.revoke(TARGET_MEMBERSHIP_ID, AUTHORIZATION)).status, "revoked");
  assert.equal(
    (await controller.promoteOwner(TARGET_MEMBERSHIP_ID, AUTHORIZATION)).roleKey,
    SYSTEM_ROLES.tenantOwner,
  );
  assert.equal(
    (await controller.demoteOwner(TARGET_MEMBERSHIP_ID, AUTHORIZATION)).roleKey,
    SYSTEM_ROLES.tenantAdmin,
  );

  assert.deepEqual(calls, [
    ["list", { authorization: AUTHORIZATION, requestId: AUTHENTICATED.requestId }],
    [
      "suspend",
      {
        authorization: AUTHORIZATION,
        membershipId: TARGET_MEMBERSHIP_ID,
        requestId: AUTHENTICATED.requestId,
      },
    ],
    [
      "revoke",
      {
        authorization: AUTHORIZATION,
        membershipId: TARGET_MEMBERSHIP_ID,
        requestId: AUTHENTICATED.requestId,
      },
    ],
    [
      "promote",
      {
        authorization: AUTHORIZATION,
        membershipId: TARGET_MEMBERSHIP_ID,
        requestId: AUTHENTICATED.requestId,
      },
    ],
    [
      "demote",
      {
        authorization: AUTHORIZATION,
        membershipId: TARGET_MEMBERSHIP_ID,
        requestId: AUTHENTICATED.requestId,
      },
    ],
  ]);
});

test("final-owner demotion is exposed as conflict", async () => {
  const { controller } = controllerWith({ demoteError: new LastTenantOwnerError() });

  await assert.rejects(
    () => controller.demoteOwner(TARGET_MEMBERSHIP_ID, AUTHORIZATION),
    ConflictException,
  );
});
