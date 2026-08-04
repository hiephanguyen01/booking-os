import assert from "node:assert/strict";
import test from "node:test";

import type { HealthDependencyStatus } from "@booking-os/contracts";
import { createStructuredLogger, type StructuredLogRecord } from "@booking-os/observability";

import type { Environment } from "../config/environment.schema.js";
import { EnvironmentService } from "../config/environment.service.js";
import type { ReadinessDependency, ReadinessProbe } from "../dependencies/readiness-probe.js";
import { HealthResponseFactory } from "./health-response.factory.js";
import { ReadinessCoordinator } from "./readiness-coordinator.js";
import type { ReadinessTimerScheduler } from "./readiness-timeout.js";

const ok = (latencyMs: number): HealthDependencyStatus => ({ status: "ok", latencyMs });
const unavailable = (
  latencyMs: number,
  message: "timeout" | "connection_failed" | "unexpected_response",
): HealthDependencyStatus => ({ status: "unavailable", latencyMs, message });

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createProbe(
  dependency: ReadinessDependency,
  check: () => Promise<HealthDependencyStatus>,
): ReadinessProbe {
  return { dependency, check };
}

function createManualScheduler() {
  let nextHandle = 1;
  const callbacks = new Map<number, () => void>();
  const delays: number[] = [];

  const scheduler: ReadinessTimerScheduler = {
    set(callback, delayMs) {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      delays.push(delayMs);
      return handle;
    },
    clear(handle) {
      callbacks.delete(handle as number);
    },
  };

  return {
    scheduler,
    delays,
    get pendingCount() {
      return callbacks.size;
    },
    fireAll() {
      for (const callback of [...callbacks.values()]) {
        callback();
      }
    },
  };
}

function createHarness(options?: {
  readonly postgresCheck?: () => Promise<HealthDependencyStatus>;
  readonly redisCheck?: () => Promise<HealthDependencyStatus>;
  readonly scheduler?: ReadinessTimerScheduler;
}) {
  let monotonicNow = 0;
  const records: StructuredLogRecord[] = [];
  const environment: Environment = {
    nodeEnvironment: "test",
    host: "127.0.0.1",
    port: 3101,
    apiPrefix: "api",
    appVersion: "0.1.0-test",
    logLevel: "debug",
    databaseUrl: "postgresql://booking:booking@localhost:5432/booking_os_test",
    redisUrl: "redis://localhost:6379/1",
    readinessTimeoutMs: 750,
  };
  const environmentService = new EnvironmentService(environment);
  const responseFactory = new HealthResponseFactory(
    environmentService,
    () => monotonicNow,
    () => new Date("2026-08-04T03:40:00.000Z"),
  );
  const logger = createStructuredLogger({
    service: "api",
    sink: (record) => records.push(record),
    now: () => new Date("2026-08-04T03:40:00.000Z"),
  });
  const coordinator = new ReadinessCoordinator(
    createProbe("postgresql", options?.postgresCheck ?? (async () => ok(3))),
    createProbe("redis", options?.redisCheck ?? (async () => ok(2))),
    environmentService,
    responseFactory,
    logger,
    () => monotonicNow,
    options?.scheduler,
  );

  return {
    coordinator,
    records,
    setNow(value: number) {
      monotonicNow = value;
    },
  };
}

test("starts both probes before either resolves and returns HTTP 200", async () => {
  const postgres = createDeferred<HealthDependencyStatus>();
  const redis = createDeferred<HealthDependencyStatus>();
  let postgresCalls = 0;
  let redisCalls = 0;
  const harness = createHarness({
    postgresCheck: () => {
      postgresCalls += 1;
      return postgres.promise;
    },
    redisCheck: () => {
      redisCalls += 1;
      return redis.promise;
    },
  });

  const resultPromise = harness.coordinator.getReadiness("request-1");

  assert.equal(postgresCalls, 1);
  assert.equal(redisCalls, 1);

  postgres.resolve(ok(4));
  redis.resolve(ok(2));

  const result = await resultPromise;
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.status, "ok");
  assert.deepEqual(result.body.dependencies, {
    postgresql: ok(4),
    redis: ok(2),
  });
});

test("returns HTTP 503 while preserving each actual dependency result", async () => {
  const postgresStatus = unavailable(12.5, "connection_failed");
  const harness = createHarness({
    postgresCheck: async () => postgresStatus,
    redisCheck: async () => ok(1.25),
  });

  const result = await harness.coordinator.getReadiness("request-2");

  assert.equal(result.statusCode, 503);
  assert.equal(result.body.status, "unavailable");
  assert.deepEqual(result.body.dependencies, {
    postgresql: postgresStatus,
    redis: ok(1.25),
  });
  assert.equal(harness.records.length, 1);
  assert.equal(harness.records[0]?.message, "readiness.probe_failed");
  assert.equal(harness.records[0]?.requestId, "request-2");
  assert.equal(harness.records[0]?.dependency, "postgresql");
  assert.equal(harness.records[0]?.durationMs, 12.5);
  assert.equal(harness.records[0]?.reason, "connection_failed");
});

test("maps never-resolving probes to independent concurrent timeouts", async () => {
  const timer = createManualScheduler();
  const harness = createHarness({
    postgresCheck: () => new Promise(() => undefined),
    redisCheck: () => new Promise(() => undefined),
    scheduler: timer.scheduler,
  });

  const resultPromise = harness.coordinator.getReadiness("request-timeout");

  assert.deepEqual(timer.delays, [750, 750]);
  assert.equal(timer.pendingCount, 2);

  timer.fireAll();

  const result = await resultPromise;
  assert.equal(result.statusCode, 503);
  assert.deepEqual(result.body.dependencies, {
    postgresql: unavailable(750, "timeout"),
    redis: unavailable(750, "timeout"),
  });
  assert.equal(timer.pendingCount, 0);
  assert.equal(harness.records.length, 2);
});

test("caches success for 1000ms and refreshes after expiry", async () => {
  let postgresCalls = 0;
  let redisCalls = 0;
  const harness = createHarness({
    postgresCheck: async () => {
      postgresCalls += 1;
      return ok(3);
    },
    redisCheck: async () => {
      redisCalls += 1;
      return ok(2);
    },
  });

  const first = await harness.coordinator.getReadiness("request-cache-1");
  harness.setNow(999);
  const cached = await harness.coordinator.getReadiness("request-cache-2");

  assert.equal(cached, first);
  assert.equal(postgresCalls, 1);
  assert.equal(redisCalls, 1);

  harness.setNow(1_000);
  const refreshed = await harness.coordinator.getReadiness("request-cache-3");

  assert.notEqual(refreshed, first);
  assert.equal(postgresCalls, 2);
  assert.equal(redisCalls, 2);
});

test("caches unavailable results without logging the failure again", async () => {
  let postgresCalls = 0;
  const harness = createHarness({
    postgresCheck: async () => {
      postgresCalls += 1;
      return unavailable(8, "unexpected_response");
    },
  });

  await harness.coordinator.getReadiness("request-failure-1");
  harness.setNow(500);
  await harness.coordinator.getReadiness("request-failure-2");

  assert.equal(postgresCalls, 1);
  assert.equal(harness.records.length, 1);
  assert.equal(harness.records[0]?.requestId, "request-failure-1");
});

test("deduplicates simultaneous callers into one probe pair", async () => {
  const postgres = createDeferred<HealthDependencyStatus>();
  const redis = createDeferred<HealthDependencyStatus>();
  let postgresCalls = 0;
  let redisCalls = 0;
  const harness = createHarness({
    postgresCheck: () => {
      postgresCalls += 1;
      return postgres.promise;
    },
    redisCheck: () => {
      redisCalls += 1;
      return redis.promise;
    },
  });

  const firstPromise = harness.coordinator.getReadiness("request-shared-1");
  const secondPromise = harness.coordinator.getReadiness("request-shared-2");

  assert.equal(postgresCalls, 1);
  assert.equal(redisCalls, 1);

  postgres.resolve(ok(3));
  redis.resolve(ok(2));

  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.equal(first, second);
});

test("clears in-flight state after an unexpected rejection", async () => {
  let postgresCalls = 0;
  const escaped = new Error("coordinator implementation failure");
  const harness = createHarness({
    postgresCheck: async () => {
      postgresCalls += 1;
      if (postgresCalls === 1) {
        throw escaped;
      }
      return ok(3);
    },
  });

  await assert.rejects(
    harness.coordinator.getReadiness("request-error-1"),
    (error) => error === escaped,
  );

  const recovered = await harness.coordinator.getReadiness("request-error-2");

  assert.equal(recovered.statusCode, 200);
  assert.equal(postgresCalls, 2);
});
