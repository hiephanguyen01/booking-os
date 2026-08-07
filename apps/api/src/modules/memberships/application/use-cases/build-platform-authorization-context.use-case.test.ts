import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import type { PlatformAuthorizationPort } from "../ports/platform-authorization.port.js";
import {
  BuildPlatformAuthorizationContextUseCase,
  PlatformAuthorizationDeniedError,
} from "./build-platform-authorization-context.use-case.js";

const AUTHENTICATED: AuthenticatedRequestContext = Object.freeze({
  requestId: "request-1",
  traceId: "trace-1",
  source: "internal",
  actorId: "10000000-0000-4000-8000-000000000001",
  sessionId: "20000000-0000-4000-8000-000000000001",
  authScope: Object.freeze({ type: "platform" }),
  sessionState: "active",
  authorizationVersion: 3,
});

function authorization(
  snapshot: Awaited<ReturnType<PlatformAuthorizationPort["loadActivePlatformAuthorization"]>>,
): PlatformAuthorizationPort {
  return {
    async loadActivePlatformAuthorization() {
      return snapshot;
    },
  };
}

test("builds platform authority only from the authenticated session actor and database snapshot", async () => {
  const useCase = new BuildPlatformAuthorizationContextUseCase(
    authorization({
      userAuthorizationVersion: 3,
      roleKeys: ["platform_admin"],
      permissionKeys: ["platform.tenants.provision"],
    }),
  );

  const context = await useCase.execute(AUTHENTICATED);

  assert.deepEqual(context, {
    userId: AUTHENTICATED.actorId,
    sessionId: AUTHENTICATED.sessionId,
    scope: { type: "platform" },
    roleKeys: ["platform_admin"],
    permissionKeys: ["platform.tenants.provision"],
    userAuthorizationVersion: 3,
  });
  assert.equal(Object.isFrozen(context), true);
});

test("fails closed for pending or tenant sessions, missing authority, and stale versions", async () => {
  const snapshots = [
    null,
    { userAuthorizationVersion: 2, roleKeys: ["platform_admin"] as const, permissionKeys: [] },
  ];

  for (const snapshot of snapshots) {
    const useCase = new BuildPlatformAuthorizationContextUseCase(authorization(snapshot));
    await assert.rejects(useCase.execute(AUTHENTICATED), PlatformAuthorizationDeniedError);
  }

  const useCase = new BuildPlatformAuthorizationContextUseCase(
    authorization({
      userAuthorizationVersion: 3,
      roleKeys: ["platform_admin"],
      permissionKeys: [],
    }),
  );
  await assert.rejects(
    useCase.execute({ ...AUTHENTICATED, sessionState: "invitation_pending" }),
    PlatformAuthorizationDeniedError,
  );
  await assert.rejects(
    useCase.execute({
      ...AUTHENTICATED,
      authScope: { type: "tenant", tenantId: "tenant-1" },
    }),
    PlatformAuthorizationDeniedError,
  );
});
