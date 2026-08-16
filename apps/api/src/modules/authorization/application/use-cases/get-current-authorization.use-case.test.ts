import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorizationContext } from "@booking-os/contracts";

import type { AuthorizationReadyRequestContext } from "../../../../common/request-context/request-context.types.js";
import { GetCurrentAuthorizationUseCase } from "./get-current-authorization.use-case.js";

const authenticated = {
  requestId: "request-1",
  traceId: "trace-1",
  source: "console",
  actorId: "00000000-0000-4000-8000-000000000001",
  sessionId: "00000000-0000-4000-8000-000000000002",
  authScope: { type: "platform" },
  sessionState: "active",
  authorizationVersion: 1,
} as const satisfies AuthorizationReadyRequestContext;

const context: AuthorizationContext = {
  userId: authenticated.actorId,
  sessionId: authenticated.sessionId,
  scope: { type: "platform" },
  roleKeys: ["platform_admin"],
  permissionKeys: ["platform.tenants.provision"],
  userAuthorizationVersion: 1,
};

test("returns the reconciled current authorization context", async () => {
  const calls: unknown[] = [];
  const useCase = new GetCurrentAuthorizationUseCase({
    async execute(input) {
      calls.push(input);
      return { status: "current" as const, context };
    },
  });

  const result = await useCase.execute({ authenticated, presentedToken: "session-token" });

  assert.deepEqual(calls, [{ authenticated, presentedToken: "session-token" }]);
  assert.deepEqual(result, { status: "current", context });
});

test("preserves successor token when stale authority is reconciled", async () => {
  const useCase = new GetCurrentAuthorizationUseCase({
    async execute() {
      return { status: "refreshed" as const, context, successorToken: "successor-token" };
    },
  });

  assert.deepEqual(await useCase.execute({ authenticated, presentedToken: "stale-token" }), {
    status: "refreshed",
    context,
    successorToken: "successor-token",
  });
});
