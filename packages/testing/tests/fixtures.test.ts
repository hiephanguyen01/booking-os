import assert from "node:assert/strict";
import test from "node:test";

import {
  assertHasOwnKeys,
  createHealthCheckJobFixture,
  createHealthResponseFixture,
  createLogRecordFixture,
  createSessionFixture,
} from "../src/index.js";

test("health fixtures contain deterministic defaults and fresh nested data", () => {
  const first = createHealthResponseFixture();
  const second = createHealthResponseFixture();

  assert.deepEqual(first, {
    service: "api",
    status: "ok",
    version: "0.1.0",
    timestamp: "2026-08-03T12:00:00.000Z",
    uptimeSeconds: 42,
    dependencies: {},
  });
  assert.notEqual(first, second);
  assert.notEqual(first.dependencies, second.dependencies);
});

test("health fixture clones dependency overrides", () => {
  const dependencies = {
    redis: {
      status: "degraded" as const,
      latencyMs: 125,
    },
  };

  const fixture = createHealthResponseFixture({ dependencies });
  dependencies.redis.latencyMs = 999;

  assert.equal(fixture.dependencies?.redis?.latencyMs, 125);
  assert.notEqual(fixture.dependencies, dependencies);
  assert.notEqual(fixture.dependencies?.redis, dependencies.redis);
});

test("session fixtures expose scoped protocol metadata and fresh scope data", () => {
  const first = createSessionFixture();
  const second = createSessionFixture();

  assert.deepEqual(first, {
    id: "session-1",
    userId: "user-1",
    scope: { type: "tenant", tenantId: "tenant-1" },
    hostname: "partner.example.test",
    authorizationVersion: 1,
    state: "active",
    idleExpiresAt: "2026-08-11T12:00:00.000Z",
    absoluteExpiresAt: "2026-09-03T12:00:00.000Z",
  });
  assert.notEqual(first.scope, second.scope);
});

test("session fixtures support platform scope overrides", () => {
  const fixture = createSessionFixture({ scope: { type: "platform" } });

  assert.deepEqual(fixture.scope, { type: "platform" });
});

test("job fixtures use the literal scaffold job name and clone data", () => {
  const fixture = createHealthCheckJobFixture({ correlationId: "corr-123" });
  const second = createHealthCheckJobFixture();

  assert.deepEqual(fixture, {
    id: "job-1",
    name: "health-check",
    data: { correlationId: "corr-123" },
  });
  assert.notEqual(fixture.data, second.data);
});

test("log record fixtures expose deterministic defaults", () => {
  const first = createLogRecordFixture();
  const second = createLogRecordFixture({ jobId: "job-2" });

  assert.deepEqual(first, {
    level: "info",
    message: "job.completed",
    service: "worker-critical",
    timestamp: "2026-08-03T12:00:00.000Z",
  });
  assert.equal(second.jobId, "job-2");
  assert.notEqual(first, second);
});

test("assertHasOwnKeys accepts own properties and rejects missing or inherited ones", () => {
  assert.doesNotThrow(() => assertHasOwnKeys({ id: "1", name: "test" }, ["id", "name"]));
  assert.throws(() => assertHasOwnKeys({ id: "1" }, ["id", "name"]), /name/);

  const inherited = Object.create({ id: "1" }) as object;
  assert.throws(() => assertHasOwnKeys(inherited, ["id"]), /id/);
  assert.throws(() => assertHasOwnKeys(null, ["id"]), /object/);
});
