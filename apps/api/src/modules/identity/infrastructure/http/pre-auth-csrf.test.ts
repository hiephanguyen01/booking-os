import assert from "node:assert/strict";
import test from "node:test";

import {
  PRE_AUTH_CSRF_COOKIE_NAME,
  PreAuthCsrfService,
} from "./pre-auth-csrf.js";

const SECRET = Buffer.alloc(32, 7);
const NONCE = Buffer.alloc(32, 9);
const ISSUED_AT = new Date("2026-08-05T10:30:00.000Z");

function createService(now: Date): PreAuthCsrfService {
  return new PreAuthCsrfService({
    secret: SECRET,
    now: () => now,
    randomBytes: () => NONCE,
  });
}

test("issues a host-only secure nonce cookie and opaque purpose-bound proof", () => {
  const issued = createService(ISSUED_AT).issue({
    hostname: "Console.Example.Test",
    purpose: "activation",
  });

  assert.equal(PRE_AUTH_CSRF_COOKIE_NAME, "__Host-booking_pre_auth_csrf");
  assert.equal(issued.cookie.name, PRE_AUTH_CSRF_COOKIE_NAME);
  assert.deepEqual(issued.cookie.options, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 900,
  });
  assert.equal(issued.expiresAt.toISOString(), "2026-08-05T10:45:00.000Z");
  assert.doesNotMatch(issued.token, new RegExp(issued.cookie.value, "u"));
  assert.doesNotMatch(issued.token, /console\.example\.test|activation/iu);
});

test("verifies only the exact hostname, purpose, nonce, and 15-minute window", () => {
  const issuer = createService(ISSUED_AT);
  const issued = issuer.issue({ hostname: "console.example.test", purpose: "password_reset" });

  const validAtBoundary = createService(new Date("2026-08-05T10:44:59.999Z"));
  assert.equal(
    validAtBoundary.verify({
      hostname: "console.example.test",
      purpose: "password_reset",
      nonce: issued.cookie.value,
      token: issued.token,
    }),
    true,
  );
  assert.equal(
    validAtBoundary.verify({
      hostname: "other.example.test",
      purpose: "password_reset",
      nonce: issued.cookie.value,
      token: issued.token,
    }),
    false,
  );
  assert.equal(
    validAtBoundary.verify({
      hostname: "console.example.test",
      purpose: "activation",
      nonce: issued.cookie.value,
      token: issued.token,
    }),
    false,
  );
  assert.equal(
    validAtBoundary.verify({
      hostname: "console.example.test",
      purpose: "password_reset",
      nonce: Buffer.alloc(32, 4).toString("base64url"),
      token: issued.token,
    }),
    false,
  );

  const expired = createService(new Date("2026-08-05T10:45:00.001Z"));
  assert.equal(
    expired.verify({
      hostname: "console.example.test",
      purpose: "password_reset",
      nonce: issued.cookie.value,
      token: issued.token,
    }),
    false,
  );
});
