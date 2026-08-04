import assert from "node:assert/strict";
import test from "node:test";

import type { RequestContext } from "@booking-os/contracts";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import type { EnvironmentService } from "../../../../config/environment.service.js";
import type { ResolveTenantUseCase } from "../../application/use-cases/resolve-tenant.use-case.js";
import { TenantResolutionMiddleware } from "./tenant-resolution.middleware.js";

const baseContext: RequestContext = {
  requestId: "req-1",
  traceId: "550e8400-e29b-41d4-a716-446655440000",
  source: "internal",
};

function environment(trustProxy: boolean): EnvironmentService {
  return { trustProxy } as EnvironmentService;
}

test("resolves effective hostname and enriches trusted context", async () => {
  const calls: string[] = [];
  const resolveTenant = {
    async execute(hostname: string) {
      calls.push(hostname);
      return {
        id: "550e8400-e29b-41d4-a716-446655440001",
        slug: "tenant-a",
      };
    },
  } as unknown as ResolveTenantUseCase;
  const requestContext = new RequestContextStorage();
  const middleware = new TenantResolutionMiddleware(
    environment(false),
    resolveTenant,
    requestContext,
  );
  let observed: RequestContext | undefined;
  let nextError: unknown;

  await requestContext.run(baseContext, () =>
    middleware.use(
      {
        headers: {
          host: "TENANT-A.EXAMPLE.COM:3001",
          "x-tenant-id": "550e8400-e29b-41d4-a716-446655440099",
        },
      },
      undefined,
      (error) => {
        nextError = error;
        observed = requestContext.require();
      },
    ),
  );

  assert.equal(nextError, undefined);
  assert.deepEqual(calls, ["tenant-a.example.com"]);
  assert.equal(observed?.tenantId, "550e8400-e29b-41d4-a716-446655440001");
  assert.equal(observed?.requestId, baseContext.requestId);
});

test("leaves context unchanged when tenant is unresolved", async () => {
  const resolveTenant = {
    async execute() {
      return null;
    },
  } as unknown as ResolveTenantUseCase;
  const requestContext = new RequestContextStorage();
  const middleware = new TenantResolutionMiddleware(
    environment(false),
    resolveTenant,
    requestContext,
  );
  let observed: RequestContext | undefined;

  await requestContext.run(baseContext, () =>
    middleware.use({ headers: { host: "unknown.example.com" } }, undefined, () => {
      observed = requestContext.require();
    }),
  );

  assert.equal(observed?.tenantId, undefined);
  assert.equal(observed?.requestId, baseContext.requestId);
});

test("uses forwarded hostname only when proxy trust is enabled", async () => {
  const calls: string[] = [];
  const resolveTenant = {
    async execute(hostname: string) {
      calls.push(hostname);
      return null;
    },
  } as unknown as ResolveTenantUseCase;
  const requestContext = new RequestContextStorage();
  const middleware = new TenantResolutionMiddleware(
    environment(true),
    resolveTenant,
    requestContext,
  );

  await requestContext.run(baseContext, () =>
    middleware.use(
      {
        headers: {
          host: "api.internal",
          "x-forwarded-host": "tenant-a.example.com, proxy.internal",
        },
      },
      undefined,
      () => undefined,
    ),
  );

  assert.deepEqual(calls, ["tenant-a.example.com"]);
});

test("forwards resolution failures", async () => {
  const expected = new Error("directory unavailable");
  const resolveTenant = {
    async execute() {
      throw expected;
    },
  } as unknown as ResolveTenantUseCase;
  const requestContext = new RequestContextStorage();
  const middleware = new TenantResolutionMiddleware(
    environment(false),
    resolveTenant,
    requestContext,
  );
  let nextError: unknown;

  await requestContext.run(baseContext, () =>
    middleware.use({ headers: { host: "tenant-a.example.com" } }, undefined, (error) => {
      nextError = error;
    }),
  );

  assert.equal(nextError, expected);
});
