import assert from "node:assert/strict";
import test from "node:test";

import type { Environment } from "../config/environment.schema.js";
import { EnvironmentService } from "../config/environment.service.js";
import {
  DependencyProbe,
  ReadinessChecker,
  type ReadinessDependencies,
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

class FakeDependencyProbe extends DependencyProbe {
  readonly calls: Array<{ url: string; timeoutMs: number }> = [];

  constructor(private readonly results: ReadinessDependencies) {
    super();
  }

  async check(url: string, timeoutMs: number) {
    this.calls.push({ url, timeoutMs });

    return url.startsWith("postgresql:") ? this.results.postgres : this.results.redis;
  }
}

test("ReadinessChecker checks Postgres and Redis with a one-second bound", async () => {
  const probe = new FakeDependencyProbe({
    postgres: { status: "ok", latencyMs: 8 },
    redis: { status: "ok", latencyMs: 3 },
  });
  const checker = new ReadinessChecker(new EnvironmentService(testEnvironment), probe);

  const result = await checker.check();

  assert.deepEqual(result, {
    postgres: { status: "ok", latencyMs: 8 },
    redis: { status: "ok", latencyMs: 3 },
  });
  assert.deepEqual(probe.calls, [
    { url: testEnvironment.databaseUrl, timeoutMs: 1000 },
    { url: testEnvironment.redisUrl, timeoutMs: 1000 },
  ]);
});

test("ReadinessChecker preserves an unavailable dependency result", async () => {
  const probe = new FakeDependencyProbe({
    postgres: { status: "unavailable", message: "connection_failed" },
    redis: { status: "ok" },
  });
  const checker = new ReadinessChecker(new EnvironmentService(testEnvironment), probe);

  const result = await checker.check();

  assert.equal(result.postgres.status, "unavailable");
  assert.equal(result.redis.status, "ok");
});
