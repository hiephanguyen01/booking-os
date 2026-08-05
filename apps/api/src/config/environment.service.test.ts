import assert from "node:assert/strict";
import test from "node:test";

import { parseEnvironment } from "./environment.js";
import type { Environment } from "./environment.schema.js";
import { EnvironmentService } from "./environment.service.js";

const legacyEnvironment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  trustProxy: false,
  tenantBaseDomain: "example.com",
  port: 3101,
  apiPrefix: "api",
  appVersion: "0.1.0-test",
  logLevel: "debug",
  databaseUrl: "postgresql://booking:booking@localhost:5432/booking_os_test",
  redisUrl: "redis://localhost:6379/1",
  readinessTimeoutMs: 750,
  sessionSecret: "test-only-session-secret-at-least-32-characters",
  paymentProvider: "mock",
};

test("identity security access fails closed for legacy test fixtures", () => {
  const service = new EnvironmentService(legacyEnvironment);

  assert.throws(() => service.identitySecurity, /Identity security configuration is unavailable/);
});

test("identity security access exposes a validated configuration", () => {
  const environment = parseEnvironment({
    DATABASE_URL: legacyEnvironment.databaseUrl,
    REDIS_URL: legacyEnvironment.redisUrl,
    SESSION_SECRET: legacyEnvironment.sessionSecret,
    IDENTITY_TOKEN_PEPPER: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
    IDENTITY_ENVELOPE_KEYS: '{"identity-v1":"AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI="}',
    IDENTITY_ACTIVE_ENVELOPE_KEY_ID: "identity-v1",
    IDENTITY_BOOTSTRAP_ENABLED: "false",
  });
  const service = new EnvironmentService(environment);

  assert.equal(service.identitySecurity, environment.identitySecurity);
});
