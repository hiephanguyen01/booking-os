import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorizationContext } from "@booking-os/contracts";

import type { AuthMetric, AuthMetricsPort } from "../../../observability/auth-metrics.port.js";
import {
  AdminRevokeUserSessionsUseCase,
  AdminSessionRevocationForbiddenError,
} from "./admin-revoke-user-sessions.use-case.js";

const targetUserId = "00000000-0000-4000-8000-000000000020";
const revokedAt = new Date("2026-08-10T08:00:00.000Z");
const hostname = "console.example.test";

function platformAuthorization(
  permissionKeys: AuthorizationContext["permissionKeys"],
): AuthorizationContext {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    sessionId: "00000000-0000-4000-8000-000000000002",
    scope: { type: "platform" },
    roleKeys: ["platform_admin"],
    permissionKeys,
    userAuthorizationVersion: 1,
  };
}

class CapturingMetrics implements AuthMetricsPort {
  readonly records: AuthMetric[] = [];

  record(metric: AuthMetric): void {
    this.records.push(metric);
  }
}

test("rejects non-platform or unprivileged authority before mutation work", async () => {
  let calls = 0;
  const metrics = new CapturingMetrics();
  const useCase = new AdminRevokeUserSessionsUseCase(
    {
      async revokeAllForUserAndAudit() {
        calls += 1;
        return 0;
      },
    },
    metrics,
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
      hostname,
    }),
    AdminSessionRevocationForbiddenError,
  );
  await assert.rejects(
    useCase.execute({
      authorization: platformAuthorization(["platform.security.audit.read"]),
      targetUserId,
      reason: "compromise",
      requestId: "request-denied",
      hostname,
    }),
    AdminSessionRevocationForbiddenError,
  );
  assert.equal(calls, 0);
  assert.deepEqual(metrics.records, []);
});

test("atomically revokes target sessions and emits bounded metric after commit", async () => {
  const calls: unknown[] = [];
  const metrics = new CapturingMetrics();
  const useCase = new AdminRevokeUserSessionsUseCase(
    {
      async revokeAllForUserAndAudit(input) {
        calls.push(input);
        return 3;
      },
    },
    metrics,
    { now: () => revokedAt },
  );

  const result = await useCase.execute({
    authorization: platformAuthorization(["platform.security.session.revoke"]),
    targetUserId,
    reason: "suspected_account_compromise",
    requestId: "request-1",
    hostname,
  });

  assert.deepEqual(calls, [
    {
      actorUserId: "00000000-0000-4000-8000-000000000001",
      targetUserId,
      revokedAt,
      revocationReason: "platform_incident:suspected_account_compromise",
      requestId: "request-1",
      hostname,
    },
  ]);
  assert.deepEqual(metrics.records, [
    {
      eventType: "session",
      purpose: "revoke",
      outcome: "success",
      scope: "platform",
      reasonFamily: "security_incident",
      delayBucket: "none",
    },
  ]);
  assert.deepEqual(result, { userId: targetUserId, revokedSessionCount: 3 });
});

test("does not emit a metric when the atomic revocation/audit transaction fails", async () => {
  const metrics = new CapturingMetrics();
  const useCase = new AdminRevokeUserSessionsUseCase(
    {
      async revokeAllForUserAndAudit() {
        throw new Error("audit write failed");
      },
    },
    metrics,
    { now: () => revokedAt },
  );

  await assert.rejects(
    useCase.execute({
      authorization: platformAuthorization(["platform.security.session.revoke"]),
      targetUserId,
      reason: "suspected_account_compromise",
      requestId: "request-1",
      hostname,
    }),
    /audit write failed/,
  );
  assert.deepEqual(metrics.records, []);
});
