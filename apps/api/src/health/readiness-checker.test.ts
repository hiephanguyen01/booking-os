import assert from "node:assert/strict";
import test from "node:test";

import type { HealthDependencyStatus } from "@booking-os/contracts/health";

import type { Environment } from "../config/environment.schema.js";
import { EnvironmentService } from "../config/environment.service.js";
import {
  DependencyProbe,
  PostgresDependencyProbe,
  ReadinessChecker,
} from "./readiness-checker.js";

const testEnvironment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  port: 3101,
  apiPrefix: "api",
  appVersion: "0.1.0-test",
  logLevel: "debug",
  databaseUrl: "postgresql://booking:booking@postgres:5432/booking_os_test",
  redisUrl: "redis://redis:6379/1",
  sessionSecret: "test-only-session-secret-at-least-32-characters",
  paymentProvider: "mock",
};

class FakeRedisProbe extends DependencyProbe {
  readonly calls: Array<{ url: string; timeoutMs: number }> = [];

  constructor(private readonly result: HealthDependencyStatus) {
    super();
  }

  async check(url: string, timeoutMs: number): Promise<HealthDependencyStatus> {
    this.calls.push({ url, timeoutMs });
    return this.result;
  }
}

class FakePostgresProbe extends PostgresDependencyProbe {
  readonly calls: number[] = [];

  constructor(private readonly result: HealthDependencyStatus) {
    super();
  }

  async check(timeoutMs: number): Promise<HealthDependencyStatus> {
    this.calls.push(timeoutMs);
    return this.result;
  }
}

test("ReadinessChecker checks Postgres and Redis with a one-second bound", async () => {
  const redisProbe = new FakeRedisProbe({ status: "ok", latencyMs: 3 });
  const postgresProbe = new FakePostgresProbe({ status: "ok", latencyMs: 8 });
  const checker = new ReadinessChecker(
    new EnvironmentService(testEnvironment),
    redisProbe,
    postgresProbe,
  );

  const result = await checker.check();

  assert.deepEqual(result, {
    postgres: { status: "ok", latencyMs: 8 },
    redis: { status: "ok", latencyMs: 3 },
  });
  assert.deepEqual(postgresProbe.calls, [1000]);
  assert.deepEqual(redisProbe.calls, [{ url: testEnvironment.redisUrl, timeoutMs: 1000 }]);
});

test("ReadinessChecker preserves an unavailable dependency result", async () => {
  const checker = new ReadinessChecker(
    new EnvironmentService(testEnvironment),
    new FakeRedisProbe({ status: "ok" }),
    new FakePostgresProbe({ status: "unavailable", message: "connection_failed" }),
  );

  const result = await checker.check();

  assert.equal(result.postgres.status, "unavailable");
  assert.equal(result.redis.status, "ok");
});
