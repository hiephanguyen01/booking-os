import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorizationContext } from "@booking-os/contracts";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import { PlatformTenantsController } from "./platform-tenants.controller.js";

const AUTHENTICATED: AuthenticatedRequestContext = {
  requestId: "request-1",
  traceId: "trace-1",
  source: "internal",
  actorId: "10000000-0000-4000-8000-000000000001",
  sessionId: "20000000-0000-4000-8000-000000000001",
  authScope: { type: "platform" },
  sessionState: "active",
  authorizationVersion: 1,
};

const AUTHORIZATION: AuthorizationContext = {
  userId: AUTHENTICATED.actorId,
  sessionId: AUTHENTICATED.sessionId,
  scope: { type: "platform" },
  roleKeys: ["platform_admin"],
  permissionKeys: ["platform.tenants.provision"],
  userAuthorizationVersion: 1,
};

test("uses only database-built platform authority, never request role or permission headers", async () => {
  let authorizationInput: AuthenticatedRequestContext | undefined;
  let provisionInput: unknown;
  const controller = new PlatformTenantsController(
    { requireAuthenticated: () => AUTHENTICATED } as never,
    {
      async execute(input: AuthenticatedRequestContext) {
        authorizationInput = input;
        return AUTHORIZATION;
      },
    } as never,
    {
      async execute(input: unknown) {
        provisionInput = input;
        return { tenantId: "tenant-1" };
      },
    } as never,
    {} as never,
    {} as never,
    { trustProxy: false },
  );

  const result = await controller.create(
    { slug: "acme", tenantName: "Acme", ownerEmail: "owner@example.com" },
    "create-acme",
    {
      headers: {
        host: "platform.example.com",
        "x-role": "tenant_owner",
        "x-permission": "tenant.membership.admin.invite",
      },
    },
  );

  assert.deepEqual(result, { tenantId: "tenant-1" });
  assert.equal(authorizationInput, AUTHENTICATED);
  assert.deepEqual(provisionInput, {
    authorization: AUTHORIZATION,
    hostname: "platform.example.com",
    idempotencyKey: "create-acme",
    slug: "acme",
    tenantName: "Acme",
    ownerEmail: "owner@example.com",
    requestId: "request-1",
  });
});
