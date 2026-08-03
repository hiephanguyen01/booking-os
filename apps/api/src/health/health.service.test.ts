import assert from "node:assert/strict";
import test from "node:test";

import type { Environment } from "../config/environment.schema.js";

import { EnvironmentService } from "../config/environment.service.js";
import { HealthService } from "./health.service.js";

const testEnvironment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  port: 3101,
  apiPrefix: "api",
  appVersion: "0.1.0-test",
  logLevel: "debug",
  databaseUrl: "postgresql://booking:booking@localhost:5432/booking_os_test",
  redisUrl: "redis://localhost:6379/1",
};

function createHealthService(): HealthService {
  const environment = new EnvironmentService(testEnvironment);

  return new HealthService(environment);
}

test("getHealth returns the API liveness contract", () => {
  const service = createHealthService();
  const response = service.getHealth();

  assert.equal(response.service, "api");
  assert.equal(response.status, "ok");
  assert.equal(response.version, "0.1.0-test");

  assert.match(response.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

  assert.ok(response.uptimeSeconds >= 0);
});

test("getReadiness returns dependency information", () => {
  const service = createHealthService();
  const response = service.getReadiness();

  assert.equal(response.status, "ok");
  assert.deepEqual(response.dependencies, {});
});
