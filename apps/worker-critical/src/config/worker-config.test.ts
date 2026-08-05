import assert from "node:assert/strict";
import test from "node:test";

import {
  HEALTH_CHECK_JOB_NAME,
  parseWorkerConfig,
  QUEUE_NAME,
  SERVICE_NAME,
} from "./worker-config.js";

const ENVELOPE_KEY = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=";
const identityEmailEnvironment = {
  IDENTITY_ENVELOPE_KEYS: JSON.stringify({ "identity-v1": ENVELOPE_KEY }),
  IDENTITY_ACTIVE_ENVELOPE_KEY_ID: "identity-v1",
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "1025",
  SMTP_SECURE: "false",
  SMTP_FROM: "no-reply@booking.test",
} as const;

test("parseWorkerConfig applies stable worker and Redis defaults", () => {
  const config = parseWorkerConfig(identityEmailEnvironment);

  assert.deepEqual(config, {
    serviceName: "worker-critical",
    queueName: "booking-critical",
    healthCheckJobName: "health-check",
    nodeEnvironment: "development",
    redis: {
      host: "127.0.0.1",
      port: 6379,
    },
    identityEncryption: {
      envelopeKeys: {
        "identity-v1": Buffer.from(ENVELOPE_KEY, "base64"),
      },
      activeEnvelopeKeyId: "identity-v1",
    },
    smtp: {
      host: "127.0.0.1",
      port: 1025,
      secure: false,
      from: "no-reply@booking.test",
    },
  });
  assert.equal(SERVICE_NAME, "worker-critical");
  assert.equal(QUEUE_NAME, "booking-critical");
  assert.equal(HEALTH_CHECK_JOB_NAME, "health-check");
});

test("parseWorkerConfig normalizes valid credentials and SMTP configuration", () => {
  const config = parseWorkerConfig({
    ...identityEmailEnvironment,
    NODE_ENV: "production",
    REDIS_HOST: "redis.internal",
    REDIS_PORT: "6380",
    REDIS_USERNAME: " booking-worker ",
    REDIS_PASSWORD: " secret ",
    SMTP_HOST: " smtp.internal ",
    SMTP_PORT: "465",
    SMTP_SECURE: "true",
    SMTP_FROM: " identity@example.com ",
  });

  assert.deepEqual(config.redis, {
    host: "redis.internal",
    port: 6380,
    username: "booking-worker",
    password: "secret",
  });
  assert.deepEqual(config.smtp, {
    host: "smtp.internal",
    port: 465,
    secure: true,
    from: "identity@example.com",
  });
});

test("parseWorkerConfig omits empty Redis credentials", () => {
  const config = parseWorkerConfig({
    ...identityEmailEnvironment,
    REDIS_USERNAME: "  ",
    REDIS_PASSWORD: "",
  });

  assert.equal(Object.hasOwn(config.redis, "username"), false);
  assert.equal(Object.hasOwn(config.redis, "password"), false);
});

test("parseWorkerConfig rejects invalid Redis and SMTP ports", () => {
  for (const port of ["0", "65536", "not-a-port"]) {
    assert.throws(
      () => parseWorkerConfig({ ...identityEmailEnvironment, REDIS_PORT: port }),
      /REDIS_PORT/,
    );
    assert.throws(
      () => parseWorkerConfig({ ...identityEmailEnvironment, SMTP_PORT: port }),
      /SMTP_PORT/,
    );
  }
});

test("parseWorkerConfig rejects malformed envelope keys", () => {
  for (const envelopeKeys of [
    undefined,
    "not-json",
    JSON.stringify({ "identity-v1": "not-base64" }),
    JSON.stringify({ "identity-v1": "AQE=" }),
  ]) {
    assert.throws(
      () =>
        parseWorkerConfig({
          ...identityEmailEnvironment,
          IDENTITY_ENVELOPE_KEYS: envelopeKeys,
        }),
      /IDENTITY_ENVELOPE_KEYS/,
    );
  }
});

test("parseWorkerConfig rejects an unknown active envelope key", () => {
  assert.throws(
    () =>
      parseWorkerConfig({
        ...identityEmailEnvironment,
        IDENTITY_ACTIVE_ENVELOPE_KEY_ID: "identity-v2",
      }),
    /IDENTITY_ACTIVE_ENVELOPE_KEY_ID/,
  );
});

test("parseWorkerConfig rejects unsafe SMTP configuration", () => {
  assert.throws(
    () => parseWorkerConfig({ ...identityEmailEnvironment, SMTP_HOST: " " }),
    /SMTP_HOST/,
  );
  assert.throws(
    () => parseWorkerConfig({ ...identityEmailEnvironment, SMTP_SECURE: "1" }),
    /SMTP_SECURE/,
  );
  assert.throws(
    () => parseWorkerConfig({ ...identityEmailEnvironment, SMTP_FROM: "not-an-email" }),
    /SMTP_FROM/,
  );
});

test("parseWorkerConfig returns immutable secret-bearing sections", () => {
  const config = parseWorkerConfig(identityEmailEnvironment);

  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.identityEncryption), true);
  assert.equal(Object.isFrozen(config.identityEncryption.envelopeKeys), true);
  assert.equal(Object.isFrozen(config.smtp), true);
});
