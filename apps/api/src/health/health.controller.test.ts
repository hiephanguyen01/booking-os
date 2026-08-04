import assert from "node:assert/strict";
import test from "node:test";

import type { HealthResponse } from "@booking-os/contracts/health";

import { HealthController } from "./health.controller.js";
import type { HealthService } from "./health.service.js";

interface FakeResponse {
  statusCode: number;
  body?: HealthResponse;
  status(code: number): FakeResponse;
  json(body: HealthResponse): FakeResponse;
}

function createResponse(): FakeResponse {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createHealthResponse(status: HealthResponse["status"]): HealthResponse {
  return {
    service: "api",
    status,
    version: "0.1.0-test",
    timestamp: "2026-08-04T04:10:00.000Z",
    uptimeSeconds: 10,
    dependencies: {
      postgres: { status: status === "ok" ? "ok" : "unavailable" },
      redis: { status: "ok" },
    },
  };
}

test("getReadiness writes HTTP 503 when a required dependency is unavailable", async () => {
  const healthService = {
    getReadiness: async () => createHealthResponse("unavailable"),
  } as unknown as HealthService;
  const controller = new HealthController(healthService);
  const response = createResponse();

  await Reflect.apply(controller.getReadiness, controller, [response]);

  assert.equal(response.statusCode, 503);
  assert.equal(response.body?.status, "unavailable");
});

test("getReadiness writes HTTP 200 when all required dependencies are ready", async () => {
  const healthService = {
    getReadiness: async () => createHealthResponse("ok"),
  } as unknown as HealthService;
  const controller = new HealthController(healthService);
  const response = createResponse();

  await Reflect.apply(controller.getReadiness, controller, [response]);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body?.status, "ok");
});
