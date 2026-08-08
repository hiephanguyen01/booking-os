import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import { BuildTenantAuthorizationContextUseCase } from "./build-tenant-authorization-context.use-case.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000001";

const AUTHENTICATED: AuthenticatedRequestContext = {
  requestId: "request-tenant-auth",
  traceId: "trace-tenant-auth",
  source: "internal",
  actorId: USER_ID,
  sessionId: "20000000-0000-4000-8000-000000000001",
  authScope: { type: "tenant", tenantId: TENANT_ID },
  sessionState: "active",
  authorizationVersion: 7,
};

test("builds tenant authority from the RLS-bound database session", async () => {
  let executionContext: unknown;
  const useCase = new BuildTenantAuthorizationContextUseCase({
    async run(context: unknown, work: (session: unknown) => Promise<unknown>) {
      executionContext = context;
      return work({
        authorization: {
          async loadActiveTenantAuthorization(userId: string) {
            assert.equal(userId, USER_ID);
            return {
              tenantSlug: "acme",
              membershipId: "40000000-0000-4000-8000-000000000001",
              membershipStatus: "active" as const,
              membershipAuthorizationVersion: 3,
              roleKeys: ["tenant_owner" as const],
              permissionKeys: ["tenant.membership.admin.invite" as const],
            };
          },
        },
      });
    },
  } as never);

  const result = await useCase.execute(AUTHENTICATED);

  assert.deepEqual(executionContext, {
    tenantId: TENANT_ID,
    requestId: AUTHENTICATED.requestId,
    traceId: AUTHENTICATED.traceId,
    source: AUTHENTICATED.source,
    actorId: USER_ID,
  });
  assert.deepEqual(result, {
    userId: USER_ID,
    sessionId: AUTHENTICATED.sessionId,
    scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" },
    membershipId: "40000000-0000-4000-8000-000000000001",
    membershipStatus: "active",
    roleKeys: ["tenant_owner"],
    permissionKeys: ["tenant.membership.admin.invite"],
    userAuthorizationVersion: 7,
    membershipAuthorizationVersion: 3,
  });
});

test("denies platform and invitation-pending sessions before querying tenant authority", async () => {
  let calls = 0;
  const useCase = new BuildTenantAuthorizationContextUseCase({
    async run() {
      calls += 1;
      return null;
    },
  } as never);

  await assert.rejects(
    useCase.execute({ ...AUTHENTICATED, authScope: { type: "platform" } }),
    /Tenant authorization is unavailable/u,
  );
  await assert.rejects(
    useCase.execute({ ...AUTHENTICATED, sessionState: "invitation_pending" }),
    /Tenant authorization is unavailable/u,
  );
  assert.equal(calls, 0);
});
