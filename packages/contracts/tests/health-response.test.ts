import assert from "node:assert/strict";
import test from "node:test";

import { HEALTH_STATUSES, type HealthResponse } from "../src/index.js";

test("health statuses expose the supported runtime values", () => {
  assert.deepEqual(HEALTH_STATUSES, ["ok", "degraded", "unavailable"]);
});

test("health response supports dependency details", () => {
  const response: HealthResponse = {
    service: "api",
    status: "ok",
    version: "0.1.0",
    timestamp: "2026-08-03T07:00:00.000Z",
    uptimeSeconds: 42,
    dependencies: {
      postgres: {
        status: "ok",
        latencyMs: 12,
      },
      redis: {
        status: "degraded",
        latencyMs: 350,
        message: "Latency exceeded the warning threshold",
      },
    },
  };

  assert.equal(response.service, "api");
  assert.equal(response.dependencies?.postgres?.status, "ok");
  assert.equal(response.dependencies?.redis?.status, "degraded");
});
