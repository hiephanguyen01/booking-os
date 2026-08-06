import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionContext } from "@nestjs/common";
import { UnauthorizedException } from "@nestjs/common";
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

const executionContext = {
  getHandler: () => function handler() {},
  getClass: () => class Controller {},
} as unknown as ExecutionContext;

function reflector(required: boolean): Reflector {
  return {
    getAllAndOverride: () => required,
  } as unknown as Reflector;
}

test("leaves health and readiness routes outside session authentication", () => {
  const guard = new SessionRequiredGuard(reflector(false), new RequestContextStorage());
  assert.equal(guard.canActivate(executionContext), true);
});

test("rejects required routes without trusted authenticated context", () => {
  const storage = new RequestContextStorage();
  const guard = new SessionRequiredGuard(reflector(true), storage);

  storage.run(BASE_CONTEXT, () => {
    assert.throws(() => guard.canActivate(executionContext), UnauthorizedException);
  });
});

test("allows required routes only after session middleware hydrates context", () => {
  const storage = new RequestContextStorage();
  const guard = new SessionRequiredGuard(reflector(true), storage);

  storage.run(AUTHENTICATED_CONTEXT, () => {
    assert.equal(guard.canActivate(executionContext), true);
    assert.deepEqual(storage.requireAuthenticated(), AUTHENTICATED_CONTEXT);
  });
});
