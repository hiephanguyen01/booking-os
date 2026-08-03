import assert from "node:assert/strict";
import test from "node:test";

import {
  HEALTH_CHECK_JOB_NAME,
  parseWorkerConfig,
  QUEUE_NAME,
  SERVICE_NAME,
} from "./worker-config.js";

test("parseWorkerConfig applies batch worker defaults", () => {
  assert.deepEqual(parseWorkerConfig({}), {
    serviceName: "worker-batch",
    queueName: "booking-batch",
    healthCheckJobName: "health-check",
    nodeEnvironment: "development",
    redis: { host: "127.0.0.1", port: 6379 },
  });
  assert.equal(SERVICE_NAME, "worker-batch");
  assert.equal(QUEUE_NAME, "booking-batch");
  assert.equal(HEALTH_CHECK_JOB_NAME, "health-check");
});

test("parseWorkerConfig trims and omits Redis credentials", () => {
  assert.deepEqual(
    parseWorkerConfig({
      NODE_ENV: "production",
      REDIS_HOST: "redis.internal",
      REDIS_PORT: "6380",
      REDIS_USERNAME: " batch-worker ",
      REDIS_PASSWORD: " secret ",
    }).redis,
    {
      host: "redis.internal",
      port: 6380,
      username: "batch-worker",
      password: "secret",
    },
  );

  const withoutCredentials = parseWorkerConfig({
    REDIS_USERNAME: " ",
    REDIS_PASSWORD: "",
  });
  assert.equal(Object.hasOwn(withoutCredentials.redis, "username"), false);
  assert.equal(Object.hasOwn(withoutCredentials.redis, "password"), false);
});

test("parseWorkerConfig rejects invalid Redis ports", () => {
  for (const port of ["0", "65536", "invalid"]) {
    assert.throws(() => parseWorkerConfig({ REDIS_PORT: port }), /REDIS_PORT/);
  }
});
