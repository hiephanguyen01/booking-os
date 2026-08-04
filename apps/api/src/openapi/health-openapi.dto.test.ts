import assert from "node:assert/strict";
import test from "node:test";

import { Module } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Test } from "@nestjs/testing";

import { HealthController } from "../health/health.controller.js";
import { HealthService } from "../health/health.service.js";

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

@Module({
  controllers: [HealthController],
  providers: [{ provide: HealthService, useValue: HEALTH_SERVICE_STUB }],
})
class HealthOpenApiTestModule {}

test("publishes named health schemas and stable operation IDs", async () => {
  const module = await Test.createTestingModule({ imports: [HealthOpenApiTestModule] }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();

  try {
    const configuration = new DocumentBuilder().setTitle("test").setVersion("1").build();
    const document = SwaggerModule.createDocument(app, configuration);

    assert.equal(document.paths["/api/health"]?.get?.operationId, "getHealth");
    assert.equal(document.paths["/api/ready"]?.get?.operationId, "getReadiness");
    assert.ok(document.components?.schemas?.HealthResponseDto);
    assert.ok(document.components?.schemas?.HealthDependencyStatusDto);
    assert.ok(document.paths["/api/ready"]?.get?.responses?.["503"]);
  } finally {
    await app.close();
  }
});
