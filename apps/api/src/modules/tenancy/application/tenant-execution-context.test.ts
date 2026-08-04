import assert from "node:assert/strict";
import test from "node:test";

import type { RequestContext } from "@booking-os/contracts";

import {
  InvalidTenantContextError,
  TenantContextConflictError,
  TenantContextUnavailableError,
} from "./tenant-context.errors.js";
import { requireTenantExecutionContext } from "./tenant-execution-context.js";

const baseContext: RequestContext = {
  requestId: "req-1",
  traceId: "550e8400-e29b-41d4-a716-446655440000",
  source: "internal",
};

test("rejects missing tenant context with a stable error class", () => {
  assert.throws(
    () => requireTenantExecutionContext(baseContext),
    (error) =>
      error instanceof TenantContextUnavailableError &&
      error.name === "TenantContextUnavailableError",
  );
});

test("rejects malformed tenant context with a stable error class", () => {
  assert.throws(
    () =>
      requireTenantExecutionContext({
        ...baseContext,
        tenantId: "tenant-a",
      }),
    (error) =>
      error instanceof InvalidTenantContextError &&
      error.name === "InvalidTenantContextError",
  );
});

test("narrows valid tenant context without cloning or mutation", () => {
  const context: RequestContext = {
    ...baseContext,
    tenantId: "550e8400-e29b-41d4-a716-446655440000",
  };

  const narrowed = requireTenantExecutionContext(context);

  assert.equal(narrowed, context);
  assert.equal(narrowed.tenantId, context.tenantId);
});

test("tenant conflict error records active and requested tenant IDs", () => {
  const error = new TenantContextConflictError("tenant-a", "tenant-b");

  assert.equal(error.name, "TenantContextConflictError");
  assert.equal(error.activeTenantId, "tenant-a");
  assert.equal(error.requestedTenantId, "tenant-b");
});
