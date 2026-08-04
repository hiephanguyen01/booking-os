import assert from "node:assert/strict";
import test from "node:test";

import { effectiveHostname } from "./effective-hostname.js";

test("uses direct host when proxy trust is disabled", () => {
  assert.equal(
    effectiveHostname({ host: "tenant-a.localhost:3001" }, false),
    "tenant-a.localhost",
  );
  assert.equal(
    effectiveHostname(
      { host: "api.internal", "x-forwarded-host": "tenant-a.example.com" },
      false,
    ),
    "api.internal",
  );
});

test("uses the first forwarded host only when proxy trust is enabled", () => {
  assert.equal(
    effectiveHostname(
      {
        host: "api.internal",
        "x-forwarded-host": "tenant-a.example.com, proxy.internal",
      },
      true,
    ),
    "tenant-a.example.com",
  );
});

test("normalizes array headers and empty values", () => {
  assert.equal(
    effectiveHostname({ host: ["TENANT-A.EXAMPLE.COM:443", "ignored.example.com"] }, false),
    "tenant-a.example.com",
  );
  assert.equal(effectiveHostname({}, false), undefined);
});
