import assert from "node:assert/strict";
import test from "node:test";

import { parseEnvironment } from "./environment.js";

const baseEnvironment = {
  DATABASE_URL: "postgresql://booking:booking@localhost:5432/booking_os_test",
  REDIS_URL: "redis://localhost:6379/1",
  SESSION_SECRET: "test-only-session-secret-at-least-32-characters",
  IDENTITY_TOKEN_PEPPER: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
  IDENTITY_ENVELOPE_KEYS: JSON.stringify({
    "identity-v1": "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=",
  }),
  IDENTITY_ACTIVE_ENVELOPE_KEY_ID: "identity-v1",
  IDENTITY_BOOTSTRAP_ENABLED: "false",
} as const;

test("accepts canonical loopback HTTP session origins outside production", () => {
  const environment = parseEnvironment({
    ...baseEnvironment,
    NODE_ENV: "development",
    SESSION_ALLOWED_ORIGINS: "http://localhost:3002,http://127.0.0.1:3002",
  });

  assert.deepEqual(environment.sessionAllowedOrigins, [
    "http://localhost:3002",
    "http://127.0.0.1:3002",
  ]);
});

test("rejects loopback HTTP session origins in production", () => {
  assert.throws(
    () =>
      parseEnvironment({
        ...baseEnvironment,
        NODE_ENV: "production",
        TENANT_BASE_DOMAIN: "example.com",
        PAYMENT_PROVIDER: "payos",
        SESSION_ALLOWED_ORIGINS: "http://localhost:3002",
      }),
    /SESSION_ALLOWED_ORIGINS/,
  );
});
