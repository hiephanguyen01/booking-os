import assert from "node:assert/strict";
import test from "node:test";

import type { HealthResponse } from "@booking-os/contracts";

import type { HealthResponseFactory } from "./health-response.factory.js";
import type { ReadinessCoordinator, ReadinessResult } from "./readiness-coordinator.js";
import { HealthService } from "./health.service.js";

const healthResponse: HealthResponse = {
  service: "api",
  status: "ok",
  version: "0.1.0-test",
  timestamp: "2026-08-04T03:50:00.000Z",
  uptimeSeconds: 10,
};

const readinessResult: ReadinessResult = {
  statusCode: 503,
  body: {
    ...healthResponse,
    status: "unavailable",
    dependencies: {
      postgresql: { status: "ok", latencyMs: 3 },
      redis: { status: "unavailable", latencyMs: 5, message: "connection_failed" },
    },
  },
};

test("getHealth delegates to the response factory without calling readiness", () => {
  let healthCalls = 0;
  let readinessCalls = 0;
  const responses = {
    createHealth() {
      healthCalls += 1;
      return healthResponse;
    },
  } as HealthResponseFactory;
  const coordinator = {
    async getReadiness() {
      readinessCalls += 1;
      return readinessResult;
    },
  } as ReadinessCoordinator;
  const service = new HealthService(responses, coordinator);

  assert.equal(service.getHealth(), healthResponse);
  assert.equal(healthCalls, 1);
  assert.equal(readinessCalls, 0);
});

test("getReadiness forwards the request ID and returns the coordinator result", async () => {
  let receivedRequestId: string | undefined;
  const responses = {
    createHealth: () => healthResponse,
  } as HealthResponseFactory;
  const coordinator = {
    async getReadiness(requestId?: string) {
      receivedRequestId = requestId;
      return readinessResult;
    },
  } as ReadinessCoordinator;
  const service = new HealthService(responses, coordinator);

  assert.equal(await service.getReadiness("request-1"), readinessResult);
  assert.equal(receivedRequestId, "request-1");
});
