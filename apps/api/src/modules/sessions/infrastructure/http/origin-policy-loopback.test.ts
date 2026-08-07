import assert from "node:assert/strict";
import test from "node:test";

import { evaluateOrigin } from "./origin-policy.js";

test("allows exact loopback HTTP origins for local BFF development", () => {
  assert.deepEqual(
    evaluateOrigin({
      origin: "http://localhost:3002",
      allowedOrigins: ["http://localhost:3002"],
    }),
    {
      allowed: true,
      allowOrigin: "http://localhost:3002",
      allowCredentials: true,
    },
  );

  assert.deepEqual(
    evaluateOrigin({
      origin: "http://127.0.0.1:3002",
      allowedOrigins: ["http://127.0.0.1:3002"],
    }),
    {
      allowed: true,
      allowOrigin: "http://127.0.0.1:3002",
      allowCredentials: true,
    },
  );
});

test("continues to reject non-loopback HTTP origins", () => {
  assert.throws(
    () =>
      evaluateOrigin({
        origin: "http://console.example.com",
        allowedOrigins: ["http://console.example.com"],
      }),
    /origin/i,
  );
});
