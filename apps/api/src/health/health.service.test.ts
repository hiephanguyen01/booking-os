import assert from "node:assert/strict";
import test from "node:test";

import type { Environment } from "../config/environment.schema.js";

import { EnvironmentService } from "../config/environment.service.js";
import { HealthService } from "./health.service.js";
import type { ReadinessChecker, ReadinessDependencies } from "./readiness-checker.js";

const testEnvironment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  port: 3101,
  apiPrefix: "api",
  appVersion: "0.1.0-test",
  logLevel: "debug",
  databaseUrl: "postgresql://booking:booking@localhost:5432/booking_os_test",
  redisUrl: "redis://localhost:6379/1",
  sessionSecret: "test-only-session-secret-at-least-32-characters",
  paymentProvider: "mock",
};

function createHealthService(
  dependencies: ReadinessDependencies = {
    postgres: { status: "ok" },
    redis: { status: "ok" },
  },
): HealthService {
  const environment = new EnvironmentService(testEnvironment);
  const readinessChecker = {
    check: async () => dependencies,
  } as ReadinessChecker;

  return new HealthService(environment, readinessChecker);
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

test("getReadiness returns dependency information", async () => {
  const service = createHealthService({
    postgres: { status: "ok", latencyMs: 7 },
    redis: { status: "ok", latencyMs: 2 },
  });
  const response = await service.getReadiness();

  assert.equal(response.status, "ok");
  assert.deepEqual(response.dependencies, {
    postgres: { status: "ok", latencyMs: 7 },
    redis: { status: "ok", latencyMs: 2 },
  });
});

test("getReadiness becomes unavailable when a required dependency is down", async () => {
  const service = createHealthService({
    postgres: { status: "unavailable", message: "connection_failed" },
    redis: { status: "ok" },
  });
  const response = await service.getReadiness();

  assert.equal(response.status, "unavailable");
});
