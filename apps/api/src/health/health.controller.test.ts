import assert from "node:assert/strict";
import test from "node:test";

import type { HealthResponse } from "@booking-os/contracts/health";

import type { RequestWithContext } from "../observability/request-context.js";
import { HealthController } from "./health.controller.js";
import type { HealthService } from "./health.service.js";

interface FakeResponse {
  statusCode: number;
  status(code: number): void;
}

function createResponse(): FakeResponse {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
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
      postgresql: { status: status === "ok" ? "ok" : "unavailable" },
      redis: { status: "ok" },
    },
  };
}

test("getReadiness writes HTTP 503 when a required dependency is unavailable", async () => {
  let receivedRequestId: string | undefined;
  const body = createHealthResponse("unavailable");
  const healthService = {
    getReadiness: async (requestId?: string) => {
      receivedRequestId = requestId;
      return { statusCode: 503, body };
    },
  } as unknown as HealthService;
  const controller = new HealthController(healthService);
  const response = createResponse();
  const request = { requestId: "request-503" } as RequestWithContext;

  const result = await controller.getReadiness(request, response);

  assert.equal(receivedRequestId, "request-503");
  assert.equal(response.statusCode, 503);
  assert.equal(result, body);
});

test("getReadiness writes HTTP 200 when all required dependencies are ready", async () => {
  const body = createHealthResponse("ok");
  const healthService = {
    getReadiness: async () => ({ statusCode: 200, body }),
  } as unknown as HealthService;
  const controller = new HealthController(healthService);
  const response = createResponse();
  const request = { requestId: "request-200" } as RequestWithContext;

  const result = await controller.getReadiness(request, response);

  assert.equal(response.statusCode, 200);
  assert.equal(result, body);
});
