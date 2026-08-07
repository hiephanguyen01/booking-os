import assert from "node:assert/strict";
import test from "node:test";

import type { AuthorizationContext } from "@booking-os/contracts";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import { PlatformTenantProvisioningError } from "../../application/use-cases/provision-tenant.use-case.js";
import {
  TenantNotAvailableError,
  TenantProvisioningConflictError,
  TenantProvisioningIdempotencyConflictError,
  TenantProvisioningInProgressError,
} from "../../domain/membership-errors.js";
import { PlatformTenantsController } from "./platform-tenants.controller.js";

const AUTHENTICATED: AuthenticatedRequestContext = {
  requestId: "request-1",
  traceId: "trace-1",
  source: "internal",
  actorId: "10000000-0000-4000-8000-000000000001",
  sessionId: "20000000-0000-4000-8000-000000000001",
  authScope: { type: "platform" },
  sessionState: "active",
  authorizationVersion: 1,
};

const AUTHORIZATION: AuthorizationContext = {
  userId: AUTHENTICATED.actorId,
  sessionId: AUTHENTICATED.sessionId,
  scope: { type: "platform" },
  roleKeys: ["platform_admin"],
  permissionKeys: ["platform.tenants.provision"],
  userAuthorizationVersion: 1,
};

test("uses only database-built platform authority, never request role or permission headers", async () => {
  let authorizationInput: AuthenticatedRequestContext | undefined;
  let provisionInput: unknown;
  const controller = new PlatformTenantsController(
    { requireAuthenticated: () => AUTHENTICATED } as never,
    {
      async execute(input: AuthenticatedRequestContext) {
        authorizationInput = input;
        return AUTHORIZATION;
      },
    } as never,
    {
      async execute(input: unknown) {
        provisionInput = input;
        return { tenantId: "tenant-1" };
      },
    } as never,
    {} as never,
    {} as never,
    { trustProxy: false },
  );

  const result = await controller.create(
    { slug: "acme", tenantName: "Acme", ownerEmail: "owner@example.com" },
    "create-acme",
    {
      headers: {
        host: "platform.example.com",
        "x-role": "tenant_owner",
        "x-permission": "tenant.membership.admin.invite",
      },
    },
  );

  assert.deepEqual(result, { tenantId: "tenant-1" });
  assert.equal(authorizationInput, AUTHENTICATED);
  assert.deepEqual(provisionInput, {
    authorization: AUTHORIZATION,
    hostname: "platform.example.com",
    idempotencyKey: "create-acme",
    slug: "acme",
    tenantName: "Acme",
    ownerEmail: "owner@example.com",
    requestId: "request-1",
  });
});

function controllerWith(
  overrides: Readonly<{
    provision?: { execute(input: unknown): Promise<unknown> };
    getProvisioning?: { execute(input: unknown): Promise<unknown> };
    resend?: { execute(input: unknown): Promise<unknown> };
  }>,
): PlatformTenantsController {
  return new PlatformTenantsController(
    { requireAuthenticated: () => AUTHENTICATED } as never,
    {
      async execute() {
        return AUTHORIZATION;
      },
    } as never,
    (overrides.provision ?? {
      async execute() {
        return {};
      },
    }) as never,
    (overrides.getProvisioning ?? {
      async execute() {
        return {};
      },
    }) as never,
    (overrides.resend ?? {
      async execute() {
        return {};
      },
    }) as never,
    { trustProxy: false },
  );
}

const VALID_BODY = {
  slug: "acme",
  tenantName: "Acme",
  ownerEmail: "owner@example.com",
};
const VALID_REQUEST = { headers: { host: "platform.example.com" } };

test("returns 400 rather than an internal error when a provisioning body field is malformed", async () => {
  const controller = controllerWith({});

  await assert.rejects(
    controller.create({ ...VALID_BODY, slug: 42 } as never, "create-acme", VALID_REQUEST),
    BadRequestException,
  );
});

test("rejects an invalid owner email before provisioning", async () => {
  const controller = controllerWith({});

  await assert.rejects(
    controller.create({ ...VALID_BODY, ownerEmail: "not-an-email" }, "create-acme", VALID_REQUEST),
    BadRequestException,
  );
});

test("maps an invalid tenant slug from provisioning to HTTP 400", async () => {
  const controller = controllerWith({
    provision: {
      async execute() {
        throw new PlatformTenantProvisioningError("TENANT_SLUG_INVALID", "invalid slug");
      },
    },
  });

  await assert.rejects(
    controller.create(VALID_BODY, "create-acme", VALID_REQUEST),
    BadRequestException,
  );
});

test("maps provisioning collisions and idempotency conflicts to HTTP 409", async () => {
  for (const error of [
    new TenantProvisioningConflictError(),
    new TenantProvisioningIdempotencyConflictError(),
    new TenantProvisioningInProgressError(),
  ]) {
    const controller = controllerWith({
      provision: {
        async execute() {
          throw error;
        },
      },
    });

    await assert.rejects(
      controller.create(VALID_BODY, "create-acme", VALID_REQUEST),
      ConflictException,
    );
  }
});

test("maps an incorrect platform host from provisioning to opaque HTTP 404", async () => {
  const controller = controllerWith({
    provision: {
      async execute() {
        throw new PlatformTenantProvisioningError("PLATFORM_HOST_REQUIRED", "wrong host");
      },
    },
  });

  await assert.rejects(
    controller.create(VALID_BODY, "create-acme", VALID_REQUEST),
    NotFoundException,
  );
});

test("returns 400 rather than querying provisioning state for a malformed tenant ID", async () => {
  const controller = controllerWith({});

  await assert.rejects(controller.get("not-a-uuid", VALID_REQUEST), BadRequestException);
});

test("maps unavailable provisioning state from lookup and resend to opaque HTTP 404", async () => {
  const controller = controllerWith({
    getProvisioning: {
      async execute() {
        throw new TenantNotAvailableError();
      },
    },
    resend: {
      async execute() {
        throw new TenantNotAvailableError();
      },
    },
  });

  await assert.rejects(
    controller.get("550e8400-e29b-41d4-a716-446655440001", VALID_REQUEST),
    NotFoundException,
  );
  await assert.rejects(
    controller.resendOwnerInvitation("550e8400-e29b-41d4-a716-446655440001", VALID_REQUEST),
    NotFoundException,
  );
});
