import assert from "node:assert/strict";
import test from "node:test";

import { Controller, Get, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import type { OpenAPIObject } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";

import { InternalApi } from "../api-visibility/api-visibility.decorator.js";
import { HealthController } from "../health/health.controller.js";
import { HealthService } from "../health/health.service.js";
import {
  createSupportedOpenApiDocument,
  filterSupportedOpenApiDocument,
  serializeOpenApiDocument,
} from "./openapi-document.js";

const HEALTH_SERVICE_STUB = {
  getHealth: () => ({
    service: "api",
    status: "ok" as const,
    version: "0.1.0",
    timestamp: "2026-08-04T00:00:00.000Z",
    uptimeSeconds: 1,
  }),
  getReadiness: async () => ({
    body: {
      service: "api",
      status: "ok" as const,
      version: "0.1.0",
      timestamp: "2026-08-04T00:00:00.000Z",
      uptimeSeconds: 1,
    },
    statusCode: 200,
  }),
};

@InternalApi()
@Controller("foundation/probe")
class InternalProbeController {
  @Get()
  getProbe(): { readonly ok: true } {
    return { ok: true };
  }
}

@Module({
  imports: [DiscoveryModule],
  controllers: [HealthController, InternalProbeController],
  providers: [{ provide: HealthService, useValue: HEALTH_SERVICE_STUB }],
})
class OpenApiTestModule {}

test("keeps only supported routes and serializes deterministically", async () => {
  const module = await Test.createTestingModule({ imports: [OpenApiTestModule] }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();

  try {
    const first = createSupportedOpenApiDocument(app, "api");
    const second = createSupportedOpenApiDocument(app, "api");

    assert.deepEqual(Object.keys(first.paths), ["/api/health", "/api/ready"]);
    assert.equal(serializeOpenApiDocument(first), serializeOpenApiDocument(second));
    assert.equal(serializeOpenApiDocument(first).includes("foundation/probe"), false);
    assert.deepEqual(
      Object.values(first.paths)
        .flatMap((pathItem) => Object.values(pathItem ?? {}))
        .filter((value): value is { operationId: string } =>
          Boolean(value && typeof value === "object" && "operationId" in value),
        )
        .map((operation) => operation.operationId)
        .sort(),
      ["getHealth", "getReadiness"],
    );
  } finally {
    await app.close();
  }
});

test("rejects duplicate supported operation IDs", () => {
  const document = {
    components: {},
    info: { title: "test", version: "1" },
    openapi: "3.0.0",
    paths: {
      "/api/one": {
        get: {
          operationId: "duplicate",
          responses: { 200: { description: "ok" } },
          tags: ["test"],
        },
      },
      "/api/two": {
        get: {
          operationId: "duplicate",
          responses: { 200: { description: "ok" } },
          tags: ["test"],
        },
      },
    },
  } as OpenAPIObject;
  const keys = new Set(["GET /api/one", "GET /api/two"]);

  assert.throws(
    () => filterSupportedOpenApiDocument(document, keys, keys),
    /duplicate OpenAPI operationId duplicate/,
  );
});
