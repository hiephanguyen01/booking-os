import assert from "node:assert/strict";
import test from "node:test";

import { EnvironmentValidationError, parseEnvironment } from "./environment.js";

const TOKEN_PEPPER = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=";
const ENVELOPE_KEY = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";
const identityEnvironment = {
  IDENTITY_TOKEN_PEPPER: TOKEN_PEPPER,
  IDENTITY_ENVELOPE_KEYS: JSON.stringify({ "identity-v1": ENVELOPE_KEY }),
  IDENTITY_ACTIVE_ENVELOPE_KEY_ID: "identity-v1",
  IDENTITY_BOOTSTRAP_ENABLED: "false",
} as const;

const validEnvironment = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  TRUST_PROXY: "true",
  TENANT_BASE_DOMAIN: "Example.COM",
  PORT: "3101",
  API_PREFIX: "api",
  APP_VERSION: "0.1.0-test",
  LOG_LEVEL: "debug",
  DATABASE_URL: "postgresql://booking:booking@localhost:5432/booking_os_test",
  REDIS_URL: "redis://localhost:6379/1",
  READINESS_TIMEOUT_MS: "900",
  SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
  SESSION_ALLOWED_ORIGINS: "https://console.example.com, https://partner.example.com",
  PAYMENT_PROVIDER: "mock",
  ...identityEnvironment,
} as const;

test("parseEnvironment validates and normalizes environment variables", () => {
  const environment = parseEnvironment(validEnvironment);

  assert.deepEqual(environment, {
    nodeEnvironment: "test",
    host: "127.0.0.1",
    trustProxy: true,
    tenantBaseDomain: "example.com",
    platformHostname: "platform.example.com",
    port: 3101,
    apiPrefix: "api",
    appVersion: "0.1.0-test",
    logLevel: "debug",
    databaseUrl: "postgresql://booking:booking@localhost:5432/booking_os_test",
    redisUrl: "redis://localhost:6379/1",
    readinessTimeoutMs: 900,
    sessionSecret: "test-only-session-secret-at-least-32-characters",
    sessionAllowedOrigins: ["https://console.example.com", "https://partner.example.com"],
    paymentProvider: "mock",
    identitySecurity: {
      tokenPepper: Buffer.from(TOKEN_PEPPER, "base64"),
      envelopeKeys: {
        "identity-v1": Buffer.from(ENVELOPE_KEY, "base64"),
      },
      activeEnvelopeKeyId: "identity-v1",
      bootstrapEnabled: false,
    },
  });
});

test("parseEnvironment applies safe defaults", () => {
  const environment = parseEnvironment({
    DATABASE_URL: "postgresql://booking:booking@localhost:5432/booking_os",
    REDIS_URL: "redis://localhost:6379/0",
    SESSION_SECRET: "development-only-session-secret-change-before-use",
    ...identityEnvironment,
  });

  assert.equal(environment.nodeEnvironment, "development");
  assert.equal(environment.host, "0.0.0.0");
  assert.equal(environment.trustProxy, false);
  assert.equal(environment.tenantBaseDomain, "example.com");
  assert.equal(environment.platformHostname, "platform.example.com");
  assert.equal(environment.port, 3001);
  assert.equal(environment.apiPrefix, "api");
  assert.equal(environment.appVersion, "0.1.0");
  assert.equal(environment.logLevel, "info");
  assert.equal(environment.readinessTimeoutMs, 750);
  assert.deepEqual(environment.sessionAllowedOrigins, []);
  assert.equal(environment.paymentProvider, "mock");
});

test("parseEnvironment accepts explicit disabled proxy trust", () => {
  assert.equal(parseEnvironment({ ...validEnvironment, TRUST_PROXY: "false" }).trustProxy, false);
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

test("parseEnvironment accepts an enabled bootstrap with a normalized admin email", () => {
  const environment = parseEnvironment({
    ...validEnvironment,
    IDENTITY_BOOTSTRAP_ENABLED: "true",
    IDENTITY_BOOTSTRAP_ADMIN_EMAIL: " Platform.Admin@Example.COM ",
  });

  assert.deepEqual(environment.identitySecurity.bootstrapAdminEmail, "platform.admin@example.com");
});

test("parseEnvironment rejects invalid proxy trust", () => {
  assert.throws(() => parseEnvironment({ ...validEnvironment, TRUST_PROXY: "1" }), /TRUST_PROXY/);
});

test("parseEnvironment rejects invalid readiness timeouts", () => {
  for (const value of ["99", "5001", "750.5", "not-a-number"]) {
    assert.throws(
      () => parseEnvironment({ ...validEnvironment, READINESS_TIMEOUT_MS: value }),
      EnvironmentValidationError,
    );
  }
});

test("parseEnvironment rejects non-canonical session origins", () => {
  for (const sessionAllowedOrigins of [
    "*",
    "http://console.example.com",
    "https://console.example.com/path",
    "https://console.example.com?debug=true",
    "https://Console.example.com",
    "https://console.example.com,https://console.example.com",
  ]) {
    assert.throws(
      () =>
        parseEnvironment({ ...validEnvironment, SESSION_ALLOWED_ORIGINS: sessionAllowedOrigins }),
      /SESSION_ALLOWED_ORIGINS/,
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

test("parseEnvironment rejects malformed identity token pepper", () => {
  for (const tokenPepper of [undefined, "not-base64", "AQE="]) {
    assert.throws(
      () => parseEnvironment({ ...validEnvironment, IDENTITY_TOKEN_PEPPER: tokenPepper }),
      /IDENTITY_TOKEN_PEPPER/,
    );
  }
});

test("parseEnvironment rejects malformed identity envelope keys", () => {
  for (const envelopeKeys of [
    "not-json",
    JSON.stringify({ "identity-v1": "not-base64" }),
    JSON.stringify({ "identity-v1": "AQE=" }),
  ]) {
    assert.throws(
      () => parseEnvironment({ ...validEnvironment, IDENTITY_ENVELOPE_KEYS: envelopeKeys }),
      /IDENTITY_ENVELOPE_KEYS/,
    );
  }
});

test("parseEnvironment rejects an unknown active envelope key", () => {
  assert.throws(
    () =>
      parseEnvironment({
        ...validEnvironment,
        IDENTITY_ACTIVE_ENVELOPE_KEY_ID: "identity-v2",
      }),
    /IDENTITY_ACTIVE_ENVELOPE_KEY_ID/,
  );
});

test("parseEnvironment rejects bootstrap without an admin email", () => {
  assert.throws(
    () =>
      parseEnvironment({
        ...validEnvironment,
        IDENTITY_BOOTSTRAP_ENABLED: "true",
        IDENTITY_BOOTSTRAP_ADMIN_EMAIL: undefined,
      }),
    /IDENTITY_BOOTSTRAP_ADMIN_EMAIL/,
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

test("parseEnvironment rejects a missing tenant base domain in production", () => {
  assert.throws(
    () =>
      parseEnvironment({
        ...validEnvironment,
        NODE_ENV: "production",
        TENANT_BASE_DOMAIN: undefined,
        PAYMENT_PROVIDER: "payos",
      }),
    /TENANT_BASE_DOMAIN/,
  );
});

test("parseEnvironment requires at least one session origin in production", () => {
  assert.throws(
    () =>
      parseEnvironment({
        ...validEnvironment,
        NODE_ENV: "production",
        PAYMENT_PROVIDER: "payos",
        SESSION_ALLOWED_ORIGINS: undefined,
      }),
    /SESSION_ALLOWED_ORIGINS/,
  );
});

test("parseEnvironment returns an immutable result", () => {
  const environment = parseEnvironment(validEnvironment);

  assert.equal(Object.isFrozen(environment), true);
  assert.equal(Object.isFrozen(environment.sessionAllowedOrigins), true);
  assert.equal(Object.isFrozen(environment.identitySecurity), true);
  assert.equal(Object.isFrozen(environment.identitySecurity.envelopeKeys), true);
});
