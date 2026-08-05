import assert from "node:assert/strict";
import test from "node:test";

import type { HealthDependencyStatus } from "@booking-os/contracts";

import type { Environment } from "../config/environment.schema.js";
import { EnvironmentService } from "../config/environment.service.js";
import { HealthResponseFactory } from "./health-response.factory.js";

const testEnvironment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  trustProxy: false,
  port: 3101,
  apiPrefix: "api",
  appVersion: "0.1.0-test",
  logLevel: "debug",
  databaseUrl: "postgresql://booking:booking@localhost:5432/booking_os_test",
  redisUrl: "redis://localhost:6379/1",
  readinessTimeoutMs: 750,
  sessionSecret: "test-only-session-secret-at-least-32-characters",
  paymentProvider: "mock",
};

test("creates deterministic liveness from injected application clocks", () => {
  let monotonicNow = 10_000;
  const factory = new HealthResponseFactory(
    new EnvironmentService(testEnvironment),
    () => monotonicNow,
    () => new Date("2026-08-04T03:30:00.000Z"),
  );

  monotonicNow = 12_999.9;

  assert.deepEqual(factory.createHealth(), {
    service: "api",
    status: "ok",
    version: "0.1.0-test",
    timestamp: "2026-08-04T03:30:00.000Z",
    uptimeSeconds: 2,
  });
});

test("creates readiness with the selected status and dependency results", () => {
  const dependencies: Readonly<Record<string, HealthDependencyStatus>> = {
    postgresql: { status: "unavailable", latencyMs: 750, message: "timeout" },
    redis: { status: "ok", latencyMs: 2.125 },
  };
  const factory = new HealthResponseFactory(
    new EnvironmentService(testEnvironment),
    () => 20_000,
    () => new Date("2026-08-04T03:31:00.000Z"),
  );

  assert.deepEqual(factory.createReadiness("unavailable", dependencies), {
    service: "api",
    status: "unavailable",
    version: "0.1.0-test",
    timestamp: "2026-08-04T03:31:00.000Z",
    uptimeSeconds: 0,
    dependencies,
  });
});

test("never returns negative uptime when the monotonic clock moves backwards", () => {
  let monotonicNow = 5_000;
  const factory = new HealthResponseFactory(
    new EnvironmentService(testEnvironment),
    () => monotonicNow,
    () => new Date("2026-08-04T03:32:00.000Z"),
  );

  monotonicNow = 4_000;

  assert.equal(factory.createHealth().uptimeSeconds, 0);
});
