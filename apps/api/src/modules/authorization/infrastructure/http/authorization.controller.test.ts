import assert from "node:assert/strict";
import test from "node:test";

import { BOOKING_SESSION_COOKIE } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { AuthorizationReadyRequestContext } from "../../../../common/request-context/request-context.types.js";
import { AuthorizationController } from "./authorization.controller.js";

const authenticated = {
  requestId: "request-1",
  actorId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  authScope: { type: "platform" },
  sessionState: "active",
  authorizationVersion: 1,
} as const satisfies AuthorizationReadyRequestContext;

const authorization: AuthorizationContext = {
  userId: authenticated.actorId,
  sessionId: authenticated.sessionId,
  scope: { type: "platform" },
  roleKeys: ["platform_admin"],
  permissionKeys: ["platform.tenants.provision"],
  userAuthorizationVersion: 1,
};

test("writes current authorization as private JSON without delegating serialization to shared caches", async () => {
  const calls: unknown[] = [];
  const controller = new AuthorizationController(
    {
      async execute(input) {
        calls.push(input);
        return { status: "current" as const, context: authorization };
      },
    },
    {
      requireAuthenticated() {
        return authenticated;
      },
    },
  );
  const headers = new Map<string, string>();
  let body = "";

  await controller.current(
    { headers: { cookie: `${BOOKING_SESSION_COOKIE}=presented-token` } },
    {
      setHeader(name, value) {
        headers.set(name.toLowerCase(), value);
      },
      end(value) {
        body = value;
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { authenticated, presentedToken: "presented-token" });
  assert.equal(headers.get("cache-control"), "private, no-store");
  assert.equal(headers.get("vary"), "Cookie, Origin");
  assert.equal(headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(headers.has("etag"), false);
  assert.deepEqual(JSON.parse(body), authorization);
});
