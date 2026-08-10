import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorizationContext } from "@booking-os/contracts";

import {
  AdminRevokeUserSessionsUseCase,
  AdminSessionRevocationForbiddenError,
} from "./admin-revoke-user-sessions.use-case.js";

const targetUserId = "00000000-0000-4000-8000-000000000020";
const revokedAt = new Date("2026-08-10T08:00:00.000Z");

function platformAuthorization(permissionKeys: AuthorizationContext["permissionKeys"]): AuthorizationContext {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
    scope: { type: "platform" },
    roleKeys: ["platform_admin"],
    permissionKeys,
    userAuthorizationVersion: 1,
  };
}

test("rejects non-platform or unprivileged authority before repository work", async () => {
  let calls = 0;
  const useCase = new AdminRevokeUserSessionsUseCase(
    {
      async revokeAllForUser() {
        calls += 1;
        return 0;
      },
    },
    { now: () => revokedAt },
  );

  const tenantAuthorization: AuthorizationContext = {
    userId: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
    scope: {
      type: "tenant",
      tenantId: "00000000-0000-4000-8000-000000000003",
      tenantSlug: "acme",
    },
    membershipId: "00000000-0000-4000-8000-000000000004",
    membershipStatus: "active",
    roleKeys: ["tenant_owner"],
    permissionKeys: ["tenant.security.session.revoke"],
    userAuthorizationVersion: 1,
    membershipAuthorizationVersion: 1,
  };

  await assert.rejects(
    useCase.execute({
      authorization: tenantAuthorization,
      targetUserId,
      reason: "compromise",
      requestId: "request-tenant",
    }),
    AdminSessionRevocationForbiddenError,
  );
  await assert.rejects(
    useCase.execute({
      authorization: platformAuthorization(["platform.security.audit.read"]),
      targetUserId,
      reason: "compromise",
      requestId: "request-denied",
    }),
    AdminSessionRevocationForbiddenError,
  );
  assert.equal(calls, 0);
});

test("revokes every target session with a bounded platform incident reason", async () => {
  const calls: unknown[] = [];
  const useCase = new AdminRevokeUserSessionsUseCase(
    {
      async revokeAllForUser(input) {
        calls.push(input);
        return 3;
      },
    },
    { now: () => revokedAt },
  );

  const result = await useCase.execute({
    authorization: platformAuthorization(["platform.security.session.revoke"]),
    targetUserId,
    reason: "suspected_account_compromise",
    requestId: "request-1",
  });

  assert.deepEqual(calls, [
    {
      userId: targetUserId,
      revokedAt,
      reason: "platform_incident:suspected_account_compromise",
    },
  ]);
  assert.deepEqual(result, { userId: targetUserId, revokedSessionCount: 3 });
});
