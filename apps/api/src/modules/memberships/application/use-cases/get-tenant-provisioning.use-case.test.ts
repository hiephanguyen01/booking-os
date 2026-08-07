import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import { PlatformTenantProvisioningError } from "./provision-tenant.use-case.js";
import { GetTenantProvisioningUseCase } from "./get-tenant-provisioning.use-case.js";

const PLATFORM_AUTHORIZATION: AuthorizationContext = Object.freeze({
  userId: "10000000-0000-4000-8000-000000000001",
  sessionId: "20000000-0000-4000-8000-000000000001",
  scope: Object.freeze({ type: "platform" }),
  roleKeys: Object.freeze(["platform_admin"] as const),
  permissionKeys: Object.freeze([PERMISSION_KEYS.platformTenantsProvision]),
  userAuthorizationVersion: 1,
});

const TENANT_ID = "30000000-0000-4000-8000-000000000001";

function command(overrides: Record<string, unknown> = {}) {
  return {
    authorization: PLATFORM_AUTHORIZATION,
    hostname: "platform.booking.test",
    tenantId: TENANT_ID,
    ...overrides,
  };
}

function createHarness() {
  const calls: Array<{ actorUserId: string; tenantId: string }> = [];
  const workflow = {
    async getProvisioning(input: { actorUserId: string; tenantId: string }) {
      calls.push(input);
      return {
        tenantId: input.tenantId,
        slug: "acme",
        status: "provisioning" as const,
        ownerMembershipId: "40000000-0000-4000-8000-000000000001",
        ownerInvitationId: "50000000-0000-4000-8000-000000000001",
      };
    },
  };
  const useCase = new GetTenantProvisioningUseCase(workflow, {
    platformHostname: "platform.booking.test",
  });
  return { calls, useCase };
}

test("rejects a tenant-scoped actor before querying provisioning state", async () => {
  const { calls, useCase } = createHarness();
  const authorization: AuthorizationContext = {
    ...PLATFORM_AUTHORIZATION,
    scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" },
  };

  await assert.rejects(
    useCase.execute(command({ authorization })),
    (error: unknown) =>
      error instanceof PlatformTenantProvisioningError && error.code === "PLATFORM_SCOPE_REQUIRED",
  );
  assert.equal(calls.length, 0);
});

test("requires the exact platform hostname before querying provisioning state", async () => {
  const { calls, useCase } = createHarness();

  await assert.rejects(
    useCase.execute(command({ hostname: "acme.booking.test" })),
    (error: unknown) =>
      error instanceof PlatformTenantProvisioningError && error.code === "PLATFORM_HOST_REQUIRED",
  );
  assert.equal(calls.length, 0);
});

test("returns neutral provisioning state without owner existence metadata", async () => {
  const { calls, useCase } = createHarness();

  const result = await useCase.execute(command());

  assert.deepEqual(result, {
    tenantId: TENANT_ID,
    slug: "acme",
    status: "provisioning",
    ownerMembershipId: "40000000-0000-4000-8000-000000000001",
    ownerInvitationId: "50000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(calls, [
    {
      actorUserId: PLATFORM_AUTHORIZATION.userId,
      tenantId: TENANT_ID,
    },
  ]);
});
