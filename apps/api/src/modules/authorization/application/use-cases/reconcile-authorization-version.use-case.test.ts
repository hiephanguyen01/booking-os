import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorizationContext } from "@booking-os/contracts";

import { AuthorizationSubjectInactiveError } from "../../domain/authorization.errors.js";
import type { SessionAuthorizationRefreshPort } from "../ports/session-authorization-refresh.port.js";
import { ReconcileAuthorizationVersionUseCase } from "./reconcile-authorization-version.use-case.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const SESSION_ID = "20000000-0000-4000-8000-000000000001";
const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const AUTHENTICATED = Object.freeze({
  requestId: "request-reconcile",
  traceId: "trace-reconcile",
  source: "internal",
  actorId: USER_ID,
  sessionId: SESSION_ID,
  authScope: Object.freeze({ type: "tenant", tenantId: TENANT_ID }),
  sessionState: "active",
  authorizationVersion: 4,
  membershipAuthorizationVersion: 7,
});
const CONTEXT: AuthorizationContext = Object.freeze({
  userId: USER_ID,
  sessionId: SESSION_ID,
  scope: Object.freeze({ type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" }),
  membershipId: "40000000-0000-4000-8000-000000000001",
  membershipStatus: "active",
  roleKeys: Object.freeze(["tenant_admin"] as const),
  permissionKeys: Object.freeze(["tenant.membership.read"] as const),
  userAuthorizationVersion: 4,
  membershipAuthorizationVersion: 7,
});

class RefreshSpy implements SessionAuthorizationRefreshPort {
  readonly refreshed: unknown[] = [];
  readonly revoked: unknown[] = [];

  async refreshAndRotate(input: unknown): Promise<{ readonly successorToken: string }> {
    this.refreshed.push(input);
    return { successorToken: "successor-token" };
  }

  async revoke(input: unknown): Promise<void> {
    this.revoked.push(input);
  }
}

test("returns current authority without refreshing when both snapshots match", async () => {
  const refresh = new RefreshSpy();
  const useCase = new ReconcileAuthorizationVersionUseCase(
    { execute: async () => CONTEXT },
    refresh,
  );

  const result = await useCase.execute({
    authenticated: AUTHENTICATED,
    presentedToken: "presented-token",
  });

  assert.deepEqual(result, { status: "current", context: CONTEXT });
  assert.deepEqual(refresh.refreshed, []);
  assert.deepEqual(refresh.revoked, []);
});

test("refreshes both snapshots and rotates when permissions changed", async () => {
  const refresh = new RefreshSpy();
  const changed = { ...CONTEXT, userAuthorizationVersion: 5, membershipAuthorizationVersion: 8 };
  const useCase = new ReconcileAuthorizationVersionUseCase(
    { execute: async () => changed },
    refresh,
  );

  const result = await useCase.execute({
    authenticated: AUTHENTICATED,
    presentedToken: "presented-token",
  });

  assert.deepEqual(result, {
    status: "refreshed",
    context: changed,
    successorToken: "successor-token",
  });
  assert.deepEqual(refresh.refreshed, [
    {
      sessionId: SESSION_ID,
      userId: USER_ID,
      scope: AUTHENTICATED.authScope,
      userAuthorizationVersion: 5,
      membershipAuthorizationVersion: 8,
      presentedToken: "presented-token",
      requestId: "request-reconcile",
      reason: "authorization_version_changed",
    },
  ]);
  assert.deepEqual(refresh.revoked, []);
});

test("revokes the session when the authoritative subject is inactive", async () => {
  const refresh = new RefreshSpy();
  const useCase = new ReconcileAuthorizationVersionUseCase(
    {
      execute: async () => {
        throw new AuthorizationSubjectInactiveError();
      },
    },
    refresh,
  );

  await assert.rejects(
    useCase.execute({ authenticated: AUTHENTICATED, presentedToken: "presented-token" }),
    AuthorizationSubjectInactiveError,
  );
  assert.deepEqual(refresh.refreshed, []);
  assert.deepEqual(refresh.revoked, [
    {
      sessionId: SESSION_ID,
      userId: USER_ID,
      scope: AUTHENTICATED.authScope,
      requestId: "request-reconcile",
      reason: "authorization_subject_inactive",
    },
  ]);
});

test("reconciles user-only and membership-only changes without confusing the versions", async () => {
  for (const context of [
    { ...CONTEXT, userAuthorizationVersion: 5 },
    { ...CONTEXT, membershipAuthorizationVersion: 8 },
  ]) {
    const refresh = new RefreshSpy();
    const useCase = new ReconcileAuthorizationVersionUseCase(
      { execute: async () => context },
      refresh,
    );

    const result = await useCase.execute({
      authenticated: AUTHENTICATED,
      presentedToken: "presented-token",
    });

    assert.equal(result.status, "refreshed");
    assert.deepEqual(refresh.refreshed, [
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        scope: AUTHENTICATED.authScope,
        userAuthorizationVersion: context.userAuthorizationVersion,
        membershipAuthorizationVersion: context.membershipAuthorizationVersion,
        presentedToken: "presented-token",
        requestId: "request-reconcile",
        reason: "authorization_version_changed",
      },
    ]);
  }
});

test("reconciles platform scope from the trusted global snapshot only", async () => {
  const refresh = new RefreshSpy();
  const platformContext: AuthorizationContext = {
    userId: USER_ID,
    sessionId: SESSION_ID,
    scope: { type: "platform" },
    roleKeys: ["platform_admin"],
    permissionKeys: ["platform.tenants.provision"],
    userAuthorizationVersion: 4,
  };
  const useCase = new ReconcileAuthorizationVersionUseCase(
    { execute: async () => platformContext },
    refresh,
  );

  const result = await useCase.execute({
    authenticated: {
      requestId: AUTHENTICATED.requestId,
      traceId: AUTHENTICATED.traceId,
      source: AUTHENTICATED.source,
      actorId: AUTHENTICATED.actorId,
      sessionId: AUTHENTICATED.sessionId,
      authScope: { type: "platform" },
      sessionState: "active",
      authorizationVersion: AUTHENTICATED.authorizationVersion,
    },
    presentedToken: "presented-token",
  });

  assert.deepEqual(result, { status: "current", context: platformContext });
  assert.deepEqual(refresh.refreshed, []);
});
