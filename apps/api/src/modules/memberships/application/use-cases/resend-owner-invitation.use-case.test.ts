import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type { PlatformTenantProvisioningWorkflowPort } from "../ports/platform-tenant-provisioning-workflow.port.js";
import { PlatformTenantProvisioningError } from "./provision-tenant.use-case.js";
import { ResendOwnerInvitationUseCase } from "./resend-owner-invitation.use-case.js";

const PLATFORM_AUTHORIZATION: AuthorizationContext = Object.freeze({
  userId: "10000000-0000-4000-8000-000000000001",
  sessionId: "20000000-0000-4000-8000-000000000001",
  scope: Object.freeze({ type: "platform" }),
  roleKeys: Object.freeze(["platform_admin"] as const),
  permissionKeys: Object.freeze([PERMISSION_KEYS.platformTenantsProvision]),
  userAuthorizationVersion: 1,
});

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-07T11:30:00.000Z");

type ResendCall = Readonly<{
  actorUserId: string;
  tenantId: string;
  requestId: string;
  now: Date;
}>;

function command(overrides: Record<string, unknown> = {}) {
  return {
    authorization: PLATFORM_AUTHORIZATION,
    hostname: "platform.booking.test",
    tenantId: TENANT_ID,
    requestId: "request-resend-1",
    ...overrides,
  };
}

function createHarness() {
  const calls: ResendCall[] = [];
  const workflow: PlatformTenantProvisioningWorkflowPort = {
    async provision() {
      throw new Error("not used");
    },
    async resendOwnerInvitation(input) {
      calls.push(input);
      return Object.freeze({ accepted: true as const });
    },
  };
  const useCase = new ResendOwnerInvitationUseCase(
    workflow,
    { platformHostname: "platform.booking.test" },
    () => NOW,
  );
  return { calls, useCase };
}

test("rejects a tenant-scoped actor before resending the owner invitation", async () => {
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

test("rejects a platform actor without tenant provisioning permission", async () => {
  const { calls, useCase } = createHarness();
  const authorization: AuthorizationContext = {
    ...PLATFORM_AUTHORIZATION,
    permissionKeys: [],
  };

  await assert.rejects(
    useCase.execute(command({ authorization })),
    (error: unknown) =>
      error instanceof PlatformTenantProvisioningError &&
      error.code === "PLATFORM_PERMISSION_REQUIRED",
  );
  assert.equal(calls.length, 0);
});

test("requires the exact platform hostname before resending", async () => {
  const { calls, useCase } = createHarness();

  await assert.rejects(
    useCase.execute(command({ hostname: "acme.booking.test" })),
    (error: unknown) =>
      error instanceof PlatformTenantProvisioningError && error.code === "PLATFORM_HOST_REQUIRED",
  );
  assert.equal(calls.length, 0);
});

test("returns a neutral accepted response and delegates without owner existence metadata", async () => {
  const { calls, useCase } = createHarness();

  const result = await useCase.execute(command());

  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(calls, [
    {
      actorUserId: PLATFORM_AUTHORIZATION.userId,
      tenantId: TENANT_ID,
      requestId: "request-resend-1",
      now: NOW,
    },
  ]);
  assert.equal(Object.hasOwn(result, "ownerExists"), false);
  assert.equal(Object.hasOwn(result, "email"), false);
});
