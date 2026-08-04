import assert from "node:assert/strict";
import test from "node:test";

import { EnvironmentValidationError, parseEnvironment } from "./environment.js";

const validEnvironment = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: "3101",
  API_PREFIX: "api",
  APP_VERSION: "0.1.0-test",
  LOG_LEVEL: "debug",
  DATABASE_URL: "postgresql://booking:booking@localhost:5432/booking_os_test",
  REDIS_URL: "redis://localhost:6379/1",
  SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
  PAYMENT_PROVIDER: "mock",
} as const;

test("parseEnvironment validates and normalizes environment variables", () => {
  const environment = parseEnvironment(validEnvironment);

  assert.deepEqual(environment, {
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
  });
});

test("parseEnvironment applies safe defaults", () => {
  const environment = parseEnvironment({
    DATABASE_URL: "postgresql://booking:booking@localhost:5432/booking_os",
    REDIS_URL: "redis://localhost:6379/0",
    SESSION_SECRET: "development-only-session-secret-change-before-use",
  });

  assert.equal(environment.nodeEnvironment, "development");
  assert.equal(environment.host, "0.0.0.0");
  assert.equal(environment.port, 3001);
  assert.equal(environment.apiPrefix, "api");
  assert.equal(environment.appVersion, "0.1.0");
  assert.equal(environment.logLevel, "info");
  assert.equal(environment.paymentProvider, "mock");
});

test("parseEnvironment rejects invalid configuration", () => {
  assert.throws(
    () =>
      parseEnvironment({
        ...validEnvironment,
        PORT: "99999",
        DATABASE_URL: "https://example.com",
      }),
    (error: unknown) => {
      assert.ok(error instanceof EnvironmentValidationError);

      assert.match(error.message, /PORT/);
      assert.match(error.message, /DATABASE_URL/);

      return true;
    },
  );
});

test("parseEnvironment rejects a missing database URL", () => {
  assert.throws(
    () => parseEnvironment({ ...validEnvironment, DATABASE_URL: undefined }),
    /DATABASE_URL/,
  );
});

test("parseEnvironment rejects a short session secret", () => {
  assert.throws(
    () => parseEnvironment({ ...validEnvironment, SESSION_SECRET: "short" }),
    /SESSION_SECRET/,
  );
});

test("parseEnvironment rejects mock payments in production", () => {
  assert.throws(
    () =>
      parseEnvironment({
        ...validEnvironment,
        NODE_ENV: "production",
        PAYMENT_PROVIDER: "mock",
      }),
    /PAYMENT_PROVIDER/,
  );
});

test("parseEnvironment returns an immutable result", () => {
  const environment = parseEnvironment(validEnvironment);

  assert.equal(Object.isFrozen(environment), true);
});
