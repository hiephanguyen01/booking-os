import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { deriveLoginAttemptKey } from "./login-abuse-key.js";

const KEY = new Uint8Array(32).fill(0x5a);

function digest(purpose: string, value: string): string {
  return createHmac("sha256", KEY).update(`${purpose}\0${value}`, "utf8").digest("hex");
}

test("derives domain-separated account, source, and combined HMAC keys", () => {
  const result = deriveLoginAttemptKey({
    hmacKey: KEY,
    normalizedEmail: " User@Example.COM ",
    ipAddress: "203.0.113.42",
  });

  assert.equal(result.sourceSummary, "ipv4:203.0.113.0/24");
  assert.equal(result.accountDigest, digest("account", "user@example.com"));
  assert.equal(result.sourceDigest, digest("source", result.sourceSummary));
  assert.equal(
    result.combinedDigest,
    digest("combined", `${result.accountDigest}:${result.sourceDigest}`),
  );
  assert.match(result.accountDigest, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(result).includes("user@example.com"), false);
  assert.equal(JSON.stringify(result).includes("203.0.113.42"), false);
});

test("coarsens IPv6 sources to a stable privacy-preserving /56 summary", () => {
  const first = deriveLoginAttemptKey({
    hmacKey: KEY,
    normalizedEmail: "user@example.com",
    ipAddress: "2001:db8:1234:5678::1",
  });
  const second = deriveLoginAttemptKey({
    hmacKey: KEY,
    normalizedEmail: "user@example.com",
    ipAddress: "2001:db8:1234:56ff::beef",
  });
  const otherNetwork = deriveLoginAttemptKey({
    hmacKey: KEY,
    normalizedEmail: "user@example.com",
    ipAddress: "2001:db8:1234:5700::1",
  });

  assert.equal(first.sourceSummary, "ipv6:2001:db8:1234:5600::/56");
  assert.equal(second.sourceSummary, first.sourceSummary);
  assert.equal(second.sourceDigest, first.sourceDigest);
  assert.notEqual(otherNetwork.sourceDigest, first.sourceDigest);
});

test("rejects invalid addresses and undersized HMAC keys", () => {
  assert.throws(
    () =>
      deriveLoginAttemptKey({
        hmacKey: KEY,
        normalizedEmail: "user@example.com",
        ipAddress: "not-an-ip",
      }),
    TypeError,
  );
  assert.throws(
    () =>
      deriveLoginAttemptKey({
        hmacKey: new Uint8Array(16),
        normalizedEmail: "user@example.com",
        ipAddress: "203.0.113.42",
      }),
    RangeError,
  );
});
