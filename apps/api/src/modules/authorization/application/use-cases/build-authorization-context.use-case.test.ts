import assert from "node:assert/strict";
import test from "node:test";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import {
  AuthorizationAuthorityInvalidError,
  AuthorizationSessionIneligibleError,
  AuthorizationSubjectInactiveError,
} from "../../domain/authorization.errors.js";
import type {
  AuthorizationRepositoryPort,
  CurrentScopeAuthority,
} from "../ports/authorization-repository.port.js";
import { BuildAuthorizationContextUseCase } from "./build-authorization-context.use-case.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const SESSION_ID = "20000000-0000-4000-8000-000000000001";
const TENANT_ID = "30000000-0000-4000-8000-000000000001";

const PLATFORM_SESSION: AuthenticatedRequestContext = Object.freeze({
  requestId: "request-authorization",
  traceId: "trace-authorization",
  source: "internal",
  actorId: USER_ID,
  sessionId: SESSION_ID,
  authScope: Object.freeze({ type: "platform" }),
  sessionState: "active",
  authorizationVersion: 4,
});

function repository(
  authority: CurrentScopeAuthority | null,
  inspect?: (input: Parameters<AuthorizationRepositoryPort["loadCurrentScope"]>[0]) => void,
): AuthorizationRepositoryPort {
  return {
    async loadCurrentScope(input) {
      inspect?.(input);
      return authority;
    },
  };
}

test("builds immutable platform authority and deduplicates permissions", async () => {
  const useCase = new BuildAuthorizationContextUseCase(
    repository(
      {
        scope: { type: "platform" },
        userAuthorizationVersion: 5,
        roleKeys: ["platform_admin"],
        permissionKeys: ["platform.tenants.provision", "platform.tenants.provision"],
      },
      (input) => {
        assert.deepEqual(input, {
          userId: USER_ID,
          scope: { type: "platform" },
          execution: {
            requestId: "request-authorization",
            traceId: "trace-authorization",
            source: "internal",
            actorId: USER_ID,
          },
        });
      },
    ),
  );

  const context = await useCase.execute(PLATFORM_SESSION);

  assert.deepEqual(context, {
    userId: USER_ID,
    sessionId: SESSION_ID,
    scope: { type: "platform" },
    roleKeys: ["platform_admin"],
    permissionKeys: ["platform.tenants.provision"],
    userAuthorizationVersion: 5,
  });
  assert.equal(Object.isFrozen(context), true);
  assert.equal(Object.isFrozen(context.roleKeys), true);
  assert.equal(Object.isFrozen(context.permissionKeys), true);
});

test("builds only current tenant scope with active membership authority", async () => {
  const tenantSession: AuthenticatedRequestContext = Object.freeze({
    ...PLATFORM_SESSION,
    authScope: Object.freeze({ type: "tenant", tenantId: TENANT_ID }),
  });
  let requestedTenantId: string | undefined;
  const useCase = new BuildAuthorizationContextUseCase(
    repository(
      {
        scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" },
        userAuthorizationVersion: 6,
        membershipId: "40000000-0000-4000-8000-000000000001",
        membershipStatus: "active",
        membershipAuthorizationVersion: 9,
        roleKeys: ["tenant_owner"],
        permissionKeys: [
          "tenant.membership.read",
          "tenant.membership.owner.promote",
          "tenant.membership.read",
        ],
      },
      (input) => {
        requestedTenantId = input.scope.type === "tenant" ? input.scope.tenantId : undefined;
      },
    ),
  );

  const context = await useCase.execute(tenantSession);

  assert.equal(requestedTenantId, TENANT_ID);
  assert.deepEqual(context, {
    userId: USER_ID,
    sessionId: SESSION_ID,
    scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" },
    membershipId: "40000000-0000-4000-8000-000000000001",
    membershipStatus: "active",
    roleKeys: ["tenant_owner"],
    permissionKeys: ["tenant.membership.owner.promote", "tenant.membership.read"],
    userAuthorizationVersion: 6,
    membershipAuthorizationVersion: 9,
  });
});

test("rejects pending sessions before querying authority", async () => {
  let calls = 0;
  const useCase = new BuildAuthorizationContextUseCase(
    repository(null, () => {
      calls += 1;
    }),
  );

  await assert.rejects(
    useCase.execute({ ...PLATFORM_SESSION, sessionState: "invitation_pending" }),
    AuthorizationSessionIneligibleError,
  );
  assert.equal(calls, 0);
});

test("rejects inactive users or tenant memberships and unknown system roles", async () => {
  await assert.rejects(
    new BuildAuthorizationContextUseCase(repository(null)).execute(PLATFORM_SESSION),
    AuthorizationSubjectInactiveError,
  );

  const tenantSession: AuthenticatedRequestContext = {
    ...PLATFORM_SESSION,
    authScope: { type: "tenant", tenantId: TENANT_ID },
  };
  await assert.rejects(
    new BuildAuthorizationContextUseCase(
      repository({
        scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" },
        userAuthorizationVersion: 4,
        membershipId: "40000000-0000-4000-8000-000000000001",
        membershipStatus: "suspended",
        membershipAuthorizationVersion: 3,
        roleKeys: ["tenant_admin"],
        permissionKeys: [],
      }),
    ).execute(tenantSession),
    AuthorizationSubjectInactiveError,
  );

  await assert.rejects(
    new BuildAuthorizationContextUseCase(
      repository({
        scope: { type: "platform" },
        userAuthorizationVersion: 4,
        roleKeys: ["custom_superuser"],
        permissionKeys: [],
      }),
    ).execute(PLATFORM_SESSION),
    AuthorizationAuthorityInvalidError,
  );
});
