import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionContext } from "@nestjs/common";
import { NotFoundException } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { TenantRequiredGuard } from "./tenant-required.guard.js";

const executionContext = {
  getHandler: () => () => undefined,
  getClass: () => class TestController {},
} as ExecutionContext;

function reflector(required: boolean | undefined): Reflector {
  return {
    getAllAndOverride: () => required,
  } as unknown as Reflector;
}

test("allows routes that do not require tenant context", () => {
  const guard = new TenantRequiredGuard(reflector(undefined), new RequestContextStorage());

  assert.equal(guard.canActivate(executionContext), true);
});

test("allows tenant-required routes when context contains tenant", () => {
  const storage = new RequestContextStorage();
  const guard = new TenantRequiredGuard(reflector(true), storage);

  const result = storage.run(
    {
      requestId: "req-1",
      traceId: "550e8400-e29b-41d4-a716-446655440000",
      source: "internal",
      tenantId: "550e8400-e29b-41d4-a716-446655440001",
    },
    () => guard.canActivate(executionContext),
  );

  assert.equal(result, true);
});

test("returns a safe not-found error when required tenant is missing", () => {
  const guard = new TenantRequiredGuard(reflector(true), new RequestContextStorage());

  assert.throws(
    () => guard.canActivate(executionContext),
    (error) =>
      error instanceof NotFoundException &&
      error.message === "Tenant context could not be resolved",
  );
});
