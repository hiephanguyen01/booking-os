import assert from "node:assert/strict";
import test from "node:test";

import { EnvironmentValidationError, parseEnvironment } from "./environment.js";

const validEnvironment = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  TRUST_PROXY: "true",
  PORT: "3101",
  API_PREFIX: "api",
  APP_VERSION: "0.1.0-test",
  LOG_LEVEL: "debug",
  DATABASE_URL: "postgresql://booking:booking@localhost:5432/booking_os_test",
  REDIS_URL: "redis://localhost:6379/1",
  READINESS_TIMEOUT_MS: "900",
  SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
  PAYMENT_PROVIDER: "mock",
} as const;

test("parseEnvironment validates and normalizes environment variables", () => {
  const environment = parseEnvironment(validEnvironment);

  assert.deepEqual(environment, {
    nodeEnvironment: "test",
    host: "127.0.0.1",
    trustProxy: true,
    port: 3101,
    apiPrefix: "api",
    appVersion: "0.1.0-test",
    logLevel: "debug",
    databaseUrl: "postgresql://booking:booking@localhost:5432/booking_os_test",
    redisUrl: "redis://localhost:6379/1",
    readinessTimeoutMs: 900,
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
  assert.equal(environment.trustProxy, false);
  assert.equal(environment.port, 3001);
  assert.equal(environment.apiPrefix, "api");
  assert.equal(environment.appVersion, "0.1.0");
  assert.equal(environment.logLevel, "info");
  assert.equal(environment.readinessTimeoutMs, 750);
  assert.equal(environment.paymentProvider, "mock");
});

test("parseEnvironment accepts explicit disabled proxy trust", () => {
  assert.equal(
    parseEnvironment({ ...validEnvironment, TRUST_PROXY: "false" }).trustProxy,
    false,
  );
});

test("parseEnvironment rejects invalid proxy trust", () => {
  assert.throws(
    () => parseEnvironment({ ...validEnvironment, TRUST_PROXY: "1" }),
    /TRUST_PROXY/,
  );
});

test("parseEnvironment accepts readiness timeout boundaries", () => {
  assert.equal(
    parseEnvironment({ ...validEnvironment, READINESS_TIMEOUT_MS: "100" }).readinessTimeoutMs,
    100,
  );
  assert.equal(
    parseEnvironment({ ...validEnvironment, READINESS_TIMEOUT_MS: "5000" }).readinessTimeoutMs,
    5000,
  );
});

test("parseEnvironment rejects invalid readiness timeouts", () => {
  for (const value of ["99", "5001", "750.5", "not-a-number"]) {
    assert.throws(
      () => parseEnvironment({ ...validEnvironment, READINESS_TIMEOUT_MS: value }),
      EnvironmentValidationError,
    );
  }
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
