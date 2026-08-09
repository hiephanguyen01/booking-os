import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorizationContext, RequestContext } from "@booking-os/contracts";

import {
  InvalidTenantContextError,
  TenantContextConflictError,
  TenantContextUnavailableError,
} from "./tenant-context.errors.js";
import {
  requireAuthorizedTenantExecutionContext,
  requireTenantExecutionContext,
} from "./tenant-execution-context.js";

const baseContext: RequestContext = {
  requestId: "req-1",
  traceId: "550e8400-e29b-41d4-a716-446655440000",
  source: "internal",
};

const TENANT_ID = "550e8400-e29b-41d4-a716-446655440000";
const AUTHORIZATION: AuthorizationContext = Object.freeze({
  userId: "650e8400-e29b-41d4-a716-446655440000",
  sessionId: "750e8400-e29b-41d4-a716-446655440000",
  scope: Object.freeze({ type: "tenant", tenantId: TENANT_ID, tenantSlug: "alpha" }),
  membershipId: "850e8400-e29b-41d4-a716-446655440000",
  membershipStatus: "active",
  roleKeys: Object.freeze(["tenant_admin"] as const),
  permissionKeys: Object.freeze(["tenant.membership.read"] as const),
  userAuthorizationVersion: 2,
  membershipAuthorizationVersion: 3,
});

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
      error instanceof InvalidTenantContextError && error.name === "InvalidTenantContextError",
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

test("requires actor, session, and exact active tenant authorization binding", () => {
  const authorized = {
    ...baseContext,
    tenantId: TENANT_ID,
    actorId: AUTHORIZATION.userId,
    sessionId: AUTHORIZATION.sessionId,
    authorization: AUTHORIZATION,
  };

  assert.equal(requireAuthorizedTenantExecutionContext(authorized), authorized);
  for (const invalid of [
    { ...authorized, actorId: "950e8400-e29b-41d4-a716-446655440000" },
    { ...authorized, sessionId: "a50e8400-e29b-41d4-a716-446655440000" },
    { ...authorized, tenantId: "b50e8400-e29b-41d4-a716-446655440000" },
    { ...authorized, authorization: { ...AUTHORIZATION, membershipStatus: undefined } },
  ]) {
    assert.throws(() => requireAuthorizedTenantExecutionContext(invalid));
  }
});
