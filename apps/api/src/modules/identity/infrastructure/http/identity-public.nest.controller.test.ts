import assert from "node:assert/strict";
import test from "node:test";

import { BadRequestException, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { Test } from "@nestjs/testing";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { EnvironmentService } from "../../../../config/environment.service.js";
import {
  createSupportedOpenApiDocument,
  serializeOpenApiDocument,
} from "../../../../openapi/openapi-document.js";
import {
  IdentityPublicController,
  type IdentityPublicHttpRequest,
  type IdentityPublicHttpResponse,
} from "./identity-public.controller.js";
import {
  NestIdentityPublicController,
  toIdentityPublicHttpRequest,
} from "./identity-public.nest.controller.js";

const CORE_CONTROLLER_STUB = {
  getCsrf: () => ({ csrfToken: "proof", expiresAt: "2026-08-05T10:45:00.000Z" }),
  completeActivation: async () => ({ completed: true as const }),
  requestPasswordReset: async () => ({ accepted: true as const }),
  completePasswordReset: async () => ({ completed: true as const }),
};

function createControllerHarness(): {
  readonly controller: NestIdentityPublicController;
  readonly requests: IdentityPublicHttpRequest[];
  readonly response: IdentityPublicHttpResponse;
  readonly storage: RequestContextStorage;
} {
  const storage = new RequestContextStorage();
  const requests: IdentityPublicHttpRequest[] = [];
  const core = {
    ...CORE_CONTROLLER_STUB,
    completeActivation: async (
      _body: unknown,
      request: IdentityPublicHttpRequest,
    ): Promise<{ readonly completed: true }> => {
      requests.push(request);
      return { completed: true };
    },
  };

  return {
    controller: new NestIdentityPublicController(
      core as unknown as IdentityPublicController,
      { trustProxy: false, platformHostname: "platform.example.test" },
      storage,
    ),
    requests,
    response: {
      status() {
        return this;
      },
      setHeader() {},
      cookie() {},
    },
    storage,
  };
}

@Module({
  imports: [DiscoveryModule],
  controllers: [NestIdentityPublicController],
  providers: [
    { provide: IdentityPublicController, useValue: CORE_CONTROLLER_STUB },
    {
      provide: EnvironmentService,
      useValue: { trustProxy: false, platformHostname: "platform.example.test" },
    },
    RequestContextStorage,
  ],
})
class IdentityHttpTestModule {}

test("publishes exactly the four supported public identity operations and no setup route", async () => {
  const module = await Test.createTestingModule({ imports: [IdentityHttpTestModule] }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();

  try {
    const document = createSupportedOpenApiDocument(app, "api");
    assert.deepEqual(Object.keys(document.paths).sort(), [
      "/api/auth/activation/complete",
      "/api/auth/csrf",
      "/api/auth/password/forgot",
      "/api/auth/password/reset",
    ]);
    assert.deepEqual(
      Object.values(document.paths)
        .flatMap((pathItem) => Object.values(pathItem ?? {}))
        .filter((value): value is { operationId: string } =>
          Boolean(value && typeof value === "object" && "operationId" in value),
        )
        .map((operation) => operation.operationId)
        .sort(),
      [
        "completeAccountActivation",
        "completePasswordReset",
        "getPreAuthCsrf",
        "requestPasswordReset",
      ],
    );
    const serialized = serializeOpenApiDocument(document);
    assert.doesNotMatch(serialized, /bootstrap|setup/iu);
  } finally {
    await app.close();
  }
});

test("extracts only the effective hostname, exact origin, CSRF values, and request ID", () => {
  const request = toIdentityPublicHttpRequest(
    {
      hostname: " Console.Example.Test ",
      protocol: "https",
      headers: {
        host: "console.example.test",
        origin: "https://console.example.test",
        cookie:
          "other=value; __Host-booking_pre_auth_csrf=opaque-nonce; session=must-not-be-returned",
        "x-csrf-token": "opaque-proof",
      },
      requestId: "request-123",
    },
    false,
    { type: "platform" },
  );

  assert.deepEqual(request, {
    hostname: "console.example.test",
    scope: { type: "platform" },
    expectedOrigin: "https://console.example.test",
    origin: "https://console.example.test",
    csrfCookie: "opaque-nonce",
    csrfToken: "opaque-proof",
    requestId: "request-123",
  });
  assert.equal(JSON.stringify(request).includes("must-not-be-returned"), false);
});

test("uses the trusted forwarded browser target for identity CSRF", () => {
  const request = toIdentityPublicHttpRequest(
    {
      hostname: "127.0.0.1",
      protocol: "http",
      headers: {
        host: "127.0.0.1:3001",
        origin: "http://127.0.0.1:3001",
        "x-forwarded-host": "platform.booking.localhost",
      },
      requestId: null,
    },
    true,
    { type: "platform" },
  );

  assert.equal(request.hostname, "platform.booking.localhost");
  assert.equal(request.expectedOrigin, "http://127.0.0.1:3001");
  assert.equal(request.origin, "http://127.0.0.1:3001");
});

test("rejects ambiguous security headers instead of selecting one value", () => {
  assert.throws(
    () =>
      toIdentityPublicHttpRequest(
        {
          hostname: "console.example.test",
          protocol: "https",
          headers: {
            host: "console.example.test",
            origin: ["https://console.example.test", "https://attacker.example.test"],
            cookie: "__Host-booking_pre_auth_csrf=nonce",
            "x-csrf-token": ["first", "second"],
          },
          requestId: null,
        },
        false,
        { type: "platform" },
      ),
    /ambiguous identity security header/iu,
  );
});

test("derives platform scope only from the normalized exact platform hostname", async () => {
  const { controller, requests, response, storage } = createControllerHarness();

  await storage.run({ requestId: "platform-request", traceId: "trace-1", source: "console" }, () =>
    controller.completeActivation(
      { token: "selector.secret", newPassword: "correct horse battery staple" },
      {
        hostname: "ignored-by-effective-hostname.example.test",
        protocol: "https",
        headers: { host: "PLATFORM.EXAMPLE.TEST" },
        requestId: "platform-request",
      },
      response,
    ),
  );

  assert.deepEqual(
    requests.map((request) => request.scope),
    [{ type: "platform" }],
  );
});

test("derives tenant scope only from the trusted request context tenant", async () => {
  const { controller, requests, response, storage } = createControllerHarness();

  await storage.run(
    {
      requestId: "tenant-request",
      traceId: "trace-2",
      source: "console",
      tenantId: "11111111-1111-4111-8111-111111111111",
    },
    () =>
      controller.completeActivation(
        { token: "selector.secret", newPassword: "correct horse battery staple" },
        {
          hostname: "ignored-by-effective-hostname.example.test",
          protocol: "https",
          headers: { host: "studio.example.test" },
          requestId: "tenant-request",
        },
        response,
      ),
  );

  assert.deepEqual(
    requests.map((request) => request.scope),
    [{ type: "tenant", tenantId: "11111111-1111-4111-8111-111111111111" }],
  );
});

test("rejects an unresolved non-platform identity host before invoking the core", () => {
  const { controller, requests, response, storage } = createControllerHarness();

  storage.run({ requestId: "unknown-request", traceId: "trace-3", source: "console" }, () => {
    assert.throws(
      () =>
        controller.completeActivation(
          { token: "selector.secret", newPassword: "correct horse battery staple" },
          {
            hostname: "ignored-by-effective-hostname.example.test",
            protocol: "https",
            headers: { host: "unknown.example.test" },
            requestId: "unknown-request",
          },
          response,
        ),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  assert.deepEqual(requests, []);
});
