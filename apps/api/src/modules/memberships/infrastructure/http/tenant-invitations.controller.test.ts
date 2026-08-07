import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorizationContext } from "@booking-os/contracts";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import { TenantInvitationsController } from "./tenant-invitations.controller.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const INVITATION_ID = "50000000-0000-4000-8000-000000000001";

const AUTHENTICATED: AuthenticatedRequestContext = {
  requestId: "request-tenant-invite",
  traceId: "trace-tenant-invite",
  source: "internal",
  actorId: ACTOR_ID,
  sessionId: "20000000-0000-4000-8000-000000000001",
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
  roleKeys: ["tenant_owner"],
  permissionKeys: ["tenant.membership.admin.invite"],
  userAuthorizationVersion: 1,
  membershipAuthorizationVersion: 1,
};

function controllerWith() {
  const calls: Array<readonly [string, unknown]> = [];
  const controller = new TenantInvitationsController(
    { requireAuthenticated: () => AUTHENTICATED } as never,
    {
      async execute(input: unknown) {
        calls.push(["authorization", input]);
        return AUTHORIZATION;
      },
    } as never,
    {
      async execute(input: unknown) {
        calls.push(["invite", input]);
        return { accepted: true as const };
      },
    } as never,
    {
      async execute(input: unknown) {
        calls.push(["resend", input]);
        return { accepted: true as const };
      },
    } as never,
    {
      async execute(input: unknown) {
        calls.push(["current", input]);
        return {
          invitationId: INVITATION_ID,
          tenantId: TENANT_ID,
          intendedRoleKey: "tenant_admin" as const,
          hostname: "acme.example.test",
          expiresAt: new Date("2026-08-09T01:00:00.000Z"),
        };
      },
    } as never,
    { trustProxy: false },
  );
  return { calls, controller };
}

test("POST invite and resend use database-built tenant authority and return neutral responses", async () => {
  const { calls, controller } = controllerWith();
  const request = {
    headers: {
      host: "acme.example.test",
      "x-role": "platform_admin",
      "x-permission": "platform.tenants.provision",
    },
  };

  assert.deepEqual(await controller.create({ email: "admin@example.com" }, request), {
    accepted: true,
  });
  assert.deepEqual(await controller.resend(INVITATION_ID, request), { accepted: true });

  assert.deepEqual(calls, [
    ["authorization", AUTHENTICATED],
    [
      "invite",
      {
        authorization: AUTHORIZATION,
        hostname: "acme.example.test",
        email: "admin@example.com",
        requestId: AUTHENTICATED.requestId,
      },
    ],
    ["authorization", AUTHENTICATED],
    [
      "resend",
      {
        authorization: AUTHORIZATION,
        hostname: "acme.example.test",
        invitationId: INVITATION_ID,
        requestId: AUTHENTICATED.requestId,
      },
    ],
  ]);
});

test("GET current uses authenticated tenant/user binding without requiring active tenant permissions", async () => {
  const { calls, controller } = controllerWith();

  const result = await controller.current({ headers: { host: "acme.example.test" } });

  assert.equal(result.invitationId, INVITATION_ID);
  assert.deepEqual(calls, [
    [
      "current",
      {
        tenantId: TENANT_ID,
        userId: ACTOR_ID,
        hostname: "acme.example.test",
      },
    ],
  ]);
});
