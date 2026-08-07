import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import type {
  PlatformTenantProvisioningWorkflowPort,
  ProvisionPlatformTenantInput,
} from "../ports/platform-tenant-provisioning-workflow.port.js";
import {
  PlatformTenantProvisioningError,
  ProvisionTenantUseCase,
} from "./provision-tenant.use-case.js";

const PLATFORM_AUTHORIZATION: AuthorizationContext = Object.freeze({
  userId: "10000000-0000-4000-8000-000000000001",
  sessionId: "20000000-0000-4000-8000-000000000001",
  scope: Object.freeze({ type: "platform" }),
  roleKeys: Object.freeze(["platform_admin"] as const),
  permissionKeys: Object.freeze([PERMISSION_KEYS.platformTenantsProvision]),
  userAuthorizationVersion: 1,
});

const NOW = new Date("2026-08-07T05:00:00.000Z");

function command(overrides: Partial<Parameters<ProvisionTenantUseCase["execute"]>[0]> = {}) {
  return {
    authorization: PLATFORM_AUTHORIZATION,
    hostname: "platform.booking.test",
    idempotencyKey: "create-tenant-acme-20260807",
    slug: "acme",
    tenantName: "Acme Ltd",
    ownerEmail: "Owner@Example.COM",
    requestId: "request-1",
    ...overrides,
  };
}

function createHarness() {
  const calls: ProvisionPlatformTenantInput[] = [];
  const workflow: PlatformTenantProvisioningWorkflowPort = {
    async provision(input) {
      calls.push(input);
      return {
        tenantId: "30000000-0000-4000-8000-000000000001",
        slug: input.slug,
        status: "provisioning",
        ownerMembershipId: "40000000-0000-4000-8000-000000000001",
        ownerInvitationId: "50000000-0000-4000-8000-000000000001",
        replayed: false,
      };
    },
  };
  const useCase = new ProvisionTenantUseCase(
    workflow,
    {
      platformHostname: "platform.booking.test",
      tenantBaseDomain: "booking.test",
      reservedTenantSlugs: ["platform", "api", "www"],
    },
    () => NOW,
  );
  return { calls, useCase };
}

test("rejects a tenant-scoped actor before persistence", async () => {
  const { calls, useCase } = createHarness();
  const authorization: AuthorizationContext = {
    ...PLATFORM_AUTHORIZATION,
    scope: { type: "tenant", tenantId: "tenant-1", tenantSlug: "acme" },
  };

  await assert.rejects(
    useCase.execute(command({ authorization })),
    (error: unknown) =>
      error instanceof PlatformTenantProvisioningError && error.code === "PLATFORM_SCOPE_REQUIRED",
  );
  assert.equal(calls.length, 0);
});

test("rejects an actor without platform tenant provisioning permission", async () => {
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

test("requires the exact primary platform hostname", async () => {
  const { calls, useCase } = createHarness();

  await assert.rejects(
    useCase.execute(command({ hostname: "acme.booking.test" })),
    (error: unknown) =>
      error instanceof PlatformTenantProvisioningError && error.code === "PLATFORM_HOST_REQUIRED",
  );
  assert.equal(calls.length, 0);
});

test("rejects invalid and reserved tenant slugs", async () => {
  const { calls, useCase } = createHarness();

  for (const slug of ["Platform", "two.parts", "-invalid", "api"]) {
    await assert.rejects(
      useCase.execute(command({ slug })),
      (error: unknown) =>
        error instanceof PlatformTenantProvisioningError && error.code === "TENANT_SLUG_INVALID",
    );
  }
  assert.equal(calls.length, 0);
});

test("normalizes input and delegates one idempotent provisioning workflow", async () => {
  const { calls, useCase } = createHarness();

  const result = await useCase.execute(command());

  assert.deepEqual(result, {
    tenantId: "30000000-0000-4000-8000-000000000001",
    slug: "acme",
    status: "provisioning",
    ownerMembershipId: "40000000-0000-4000-8000-000000000001",
    ownerInvitationId: "50000000-0000-4000-8000-000000000001",
    replayed: false,
  });
  assert.deepEqual(calls, [
    {
      actorUserId: PLATFORM_AUTHORIZATION.userId,
      idempotencyKey: "create-tenant-acme-20260807",
      slug: "acme",
      tenantName: "Acme Ltd",
      ownerEmail: "Owner@Example.COM",
      normalizedOwnerEmail: "owner@example.com",
      tenantHostname: "acme.booking.test",
      requestId: "request-1",
      now: NOW,
    },
  ]);
});
