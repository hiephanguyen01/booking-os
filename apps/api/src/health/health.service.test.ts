import assert from "node:assert/strict";
import test from "node:test";

import { HealthService } from "./health.service.js";

test("getHealth returns the API liveness contract", () => {
  const service = new HealthService();

  const response = service.getHealth();

  assert.equal(response.service, "api");
  assert.equal(response.status, "ok");
  assert.equal(response.version, "0.1.0");
  assert.match(response.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(response.uptimeSeconds >= 0);
});

test("getReadiness returns dependency information", () => {
  const service = new HealthService();

  const response = service.getReadiness();

  assert.equal(response.status, "ok");
  assert.deepEqual(response.dependencies, {});
});
