import assert from "node:assert/strict";
import test from "node:test";

import {
  HEALTH_CHECK_JOB_NAME,
  QUEUE_NAME,
  SERVICE_NAME,
  parseWorkerConfig,
} from "./worker-config.js";

test("parseWorkerConfig applies stable worker and Redis defaults", () => {
  const config = parseWorkerConfig({});

  assert.deepEqual(config, {
    serviceName: "worker-critical",
    queueName: "booking-critical",
    healthCheckJobName: "health-check",
    nodeEnvironment: "development",
    redis: {
      host: "127.0.0.1",
      port: 6379,
    },
  });
  assert.equal(SERVICE_NAME, "worker-critical");
  assert.equal(QUEUE_NAME, "booking-critical");
  assert.equal(HEALTH_CHECK_JOB_NAME, "health-check");
});

test("parseWorkerConfig normalizes valid credentials", () => {
  const config = parseWorkerConfig({
    NODE_ENV: "production",
    REDIS_HOST: "redis.internal",
    REDIS_PORT: "6380",
    REDIS_USERNAME: " booking-worker ",
    REDIS_PASSWORD: " secret ",
  });

  assert.deepEqual(config.redis, {
    host: "redis.internal",
    port: 6380,
    username: "booking-worker",
    password: "secret",
  });
});

test("parseWorkerConfig omits empty credentials", () => {
  const config = parseWorkerConfig({
    REDIS_USERNAME: "  ",
    REDIS_PASSWORD: "",
  });

  assert.equal(Object.hasOwn(config.redis, "username"), false);
  assert.equal(Object.hasOwn(config.redis, "password"), false);
});

test("parseWorkerConfig rejects invalid Redis ports", () => {
  for (const port of ["0", "65536", "not-a-port"]) {
    assert.throws(() => parseWorkerConfig({ REDIS_PORT: port }), /REDIS_PORT/);
  }
});
