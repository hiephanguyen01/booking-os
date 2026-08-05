import assert from "node:assert/strict";
import test from "node:test";

import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { Test } from "@nestjs/testing";

import {
  createSupportedOpenApiDocument,
  serializeOpenApiDocument,
} from "../../../../openapi/openapi-document.js";
import { IdentityPublicController } from "./identity-public.controller.js";
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

@Module({
  imports: [DiscoveryModule],
  controllers: [NestIdentityPublicController],
  providers: [{ provide: IdentityPublicController, useValue: CORE_CONTROLLER_STUB }],
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
  const request = toIdentityPublicHttpRequest({
    hostname: " Console.Example.Test ",
    headers: {
      origin: "https://console.example.test",
      cookie:
        "other=value; __Host-booking_pre_auth_csrf=opaque-nonce; session=must-not-be-returned",
      "x-csrf-token": "opaque-proof",
    },
    requestId: "request-123",
  });

  assert.deepEqual(request, {
    hostname: "console.example.test",
    origin: "https://console.example.test",
    csrfCookie: "opaque-nonce",
    csrfToken: "opaque-proof",
    requestId: "request-123",
  });
  assert.equal(JSON.stringify(request).includes("must-not-be-returned"), false);
});

test("rejects ambiguous security headers instead of selecting one value", () => {
  assert.throws(
    () =>
      toIdentityPublicHttpRequest({
        hostname: "console.example.test",
        headers: {
          origin: ["https://console.example.test", "https://attacker.example.test"],
          cookie: "__Host-booking_pre_auth_csrf=nonce",
          "x-csrf-token": ["first", "second"],
        },
        requestId: null,
      }),
    /ambiguous identity security header/iu,
  );
});
