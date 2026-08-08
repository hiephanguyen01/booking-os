import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { SessionRequiredGuard } from "./session-required.guard.js";

const BASE_CONTEXT = Object.freeze({
  requestId: "request-1",
  traceId: "11111111-1111-4111-8111-111111111111",
  source: "console" as const,
});

const AUTHENTICATED_CONTEXT = Object.freeze({
  ...BASE_CONTEXT,
  actorId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
  authScope: { type: "platform" as const },
  sessionState: "active" as const,
  authorizationVersion: 3,
});

const INVITATION_PENDING_CONTEXT = Object.freeze({
  ...BASE_CONTEXT,
  actorId: "22222222-2222-4222-8222-222222222222",
  sessionId: "44444444-4444-4444-8444-444444444444",
  authScope: {
    type: "tenant" as const,
    tenantId: "55555555-5555-4555-8555-555555555555",
  },
  sessionState: "invitation_pending" as const,
  authorizationVersion: 0,
});

function executionContext(method = "GET", path = "/auth/me"): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({
      getRequest: () => ({ method, route: { path } }),
    }),
  } as unknown as ExecutionContext;
}

function reflector(required: boolean): Reflector {
  return {
    getAllAndOverride: () => required,
  } as unknown as Reflector;
}

test("leaves health and readiness routes outside session authentication for anonymous callers", () => {
  const guard = new SessionRequiredGuard(reflector(false), new RequestContextStorage());
  assert.equal(guard.canActivate(executionContext("GET", "/health")), true);
});

test("rejects required routes without trusted authenticated context", () => {
  const storage = new RequestContextStorage();
  const guard = new SessionRequiredGuard(reflector(true), storage);

  storage.run(BASE_CONTEXT, () => {
    assert.throws(() => guard.canActivate(executionContext()), UnauthorizedException);
  });
});

test("allows required routes only after session middleware hydrates active context", () => {
  const storage = new RequestContextStorage();
  const guard = new SessionRequiredGuard(reflector(true), storage);

  storage.run(AUTHENTICATED_CONTEXT, () => {
    assert.equal(guard.canActivate(executionContext()), true);
    assert.deepEqual(storage.requireAuthenticated(), AUTHENTICATED_CONTEXT);
  });
});

test("allows invitation-pending sessions only on the explicit route allowlist", () => {
  const storage = new RequestContextStorage();
  const guard = new SessionRequiredGuard(reflector(true), storage);

  storage.run(INVITATION_PENDING_CONTEXT, () => {
    assert.equal(guard.canActivate(executionContext("GET", "/auth/me")), true);
  });
});

test("denies normal authenticated routes to invitation-pending sessions", () => {
  const storage = new RequestContextStorage();
  const guard = new SessionRequiredGuard(reflector(true), storage);

  storage.run(INVITATION_PENDING_CONTEXT, () => {
    assert.throws(
      () => guard.canActivate(executionContext("GET", "/memberships")),
      ForbiddenException,
    );
  });
});

test("does not let invitation-pending sessions use anonymous probe routes as an escape hatch", () => {
  const storage = new RequestContextStorage();
  const guard = new SessionRequiredGuard(reflector(false), storage);

  storage.run(INVITATION_PENDING_CONTEXT, () => {
    assert.throws(() => guard.canActivate(executionContext("GET", "/health")), ForbiddenException);
  });
});
