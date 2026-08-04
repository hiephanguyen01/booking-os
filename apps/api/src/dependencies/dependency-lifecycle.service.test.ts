import assert from "node:assert/strict";
import test from "node:test";

import { createStructuredLogger, type StructuredLogRecord } from "@booking-os/observability";

import { DependencyLifecycleService } from "./dependency-lifecycle.service.js";
import type { PostgresPoolPort, RedisClientPort } from "./ports.js";

interface ResourceControls {
  postgresFailure?: Error;
  redisFailure?: Error;
}

function createResources(controls: ResourceControls = {}) {
  let postgresCloseCalls = 0;
  let redisQuitCalls = 0;
  const disconnectCalls: boolean[] = [];

  const postgres: PostgresPoolPort = {
    query: async () => ({ rows: [] }),
    end: async () => {
      postgresCloseCalls += 1;
      if (controls.postgresFailure) {
        throw controls.postgresFailure;
      }
    },
    on() {
      return this;
    },
  };
  const redis: RedisClientPort = {
    status: "ready",
    ping: async () => "PONG",
    quit: async () => {
      redisQuitCalls += 1;
      if (controls.redisFailure) {
        throw controls.redisFailure;
      }
      return "OK";
    },
    disconnect: (reconnect = true) => disconnectCalls.push(reconnect),
    on() {
      return this;
    },
  };

  return {
    postgres,
    redis,
    counts: () => ({ postgresCloseCalls, redisQuitCalls, disconnectCalls }),
  };
}

function createCapturedLogger(records: StructuredLogRecord[]) {
  return createStructuredLogger({
    service: "api",
    sink: (record) => records.push(record),
    now: () => new Date("2026-08-04T00:00:00.000Z"),
  });
}

test("shares one cleanup across concurrent and repeated close calls", async () => {
  const resources = createResources();
  const service = new DependencyLifecycleService(
    resources.postgres,
    resources.redis,
    createCapturedLogger([]),
  );

  const first = service.close();
  const second = service.close();
  assert.equal(first, second);

  await Promise.all([first, second, service.close()]);
  assert.deepEqual(resources.counts(), {
    postgresCloseCalls: 1,
    redisQuitCalls: 1,
    disconnectCalls: [],
  });
});

test("attempts both resources and safely logs independent cleanup failures", async () => {
  const records: StructuredLogRecord[] = [];
  const resources = createResources({
    postgresFailure: new Error("internal postgres close detail"),
    redisFailure: new Error("internal redis close detail"),
  });
  const service = new DependencyLifecycleService(
    resources.postgres,
    resources.redis,
    createCapturedLogger(records),
  );

  await service.close();

  assert.deepEqual(resources.counts(), {
    postgresCloseCalls: 1,
    redisQuitCalls: 1,
    disconnectCalls: [false],
  });
  assert.deepEqual(
    records.map((record) => ({
      message: record.message,
      dependency: record.dependency,
      error: record.error?.message,
    })),
    [
      {
        message: "dependency.shutdown_failed",
        dependency: "postgresql",
        error: "internal postgres close detail",
      },
      {
        message: "dependency.shutdown_failed",
        dependency: "redis",
        error: "internal redis close detail",
      },
    ],
  );
  for (const record of records) {
    assert.equal(Object.hasOwn(record, "url"), false);
    assert.equal(Object.hasOwn(record, "configuration"), false);
  }
});

test("application shutdown delegates to the idempotent close operation", async () => {
  const resources = createResources();
  const service = new DependencyLifecycleService(
    resources.postgres,
    resources.redis,
    createCapturedLogger([]),
  );

  await Promise.all([service.onApplicationShutdown(), service.close()]);

  assert.equal(resources.counts().postgresCloseCalls, 1);
  assert.equal(resources.counts().redisQuitCalls, 1);
});
