import assert from "node:assert/strict";
import test from "node:test";

import { evaluateOrigin } from "./origin-policy.js";

const ALLOWED_ORIGINS = [
  "https://console.example.com",
  "https://storefront.example.com:8443",
] as const;

test("allows only an exact configured origin and echoes it for credentialed CORS", () => {
  assert.deepEqual(
    evaluateOrigin({
      origin: "https://console.example.com",
      allowedOrigins: ALLOWED_ORIGINS,
    }),
    {
      allowed: true,
      allowOrigin: "https://console.example.com",
      allowCredentials: true,
    },
  );

  assert.deepEqual(
    evaluateOrigin({
      origin: "https://storefront.example.com:8443",
      allowedOrigins: ALLOWED_ORIGINS,
    }),
    {
      allowed: true,
      allowOrigin: "https://storefront.example.com:8443",
      allowCredentials: true,
    },
  );
});

test("rejects wildcard, missing, malformed, and non-exact origins", () => {
  const rejectedOrigins = [
    undefined,
    "*",
    "null",
    "http://console.example.com",
    "https://console.example.com:444",
    "https://sub.console.example.com",
    "https://console.example.com.evil.test",
    "https://storefront.example.com",
    "https://STOREfront.example.com:8443",
    "https://storefront.example.com:8443/",
    "not-a-url",
  ] as const;

  for (const origin of rejectedOrigins) {
    assert.deepEqual(
      evaluateOrigin({ origin, allowedOrigins: ALLOWED_ORIGINS }),
      {
        allowed: false,
        allowOrigin: undefined,
        allowCredentials: false,
      },
      `expected ${String(origin)} to be rejected`,
    );
  }
});

test("rejects insecure or wildcard allowlist entries instead of weakening the policy", () => {
  assert.throws(
    () => evaluateOrigin({ origin: "https://console.example.com", allowedOrigins: ["*"] }),
    /origin/i,
  );
  assert.throws(
    () =>
      evaluateOrigin({
        origin: "http://console.example.com",
        allowedOrigins: ["http://console.example.com"],
      }),
    /origin/i,
  );
  assert.throws(
    () =>
      evaluateOrigin({
        origin: "https://console.example.com/path",
        allowedOrigins: ["https://console.example.com/path"],
      }),
    /origin/i,
  );
});
