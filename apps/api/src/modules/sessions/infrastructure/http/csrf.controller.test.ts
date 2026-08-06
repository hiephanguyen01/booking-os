import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { BOOKING_SESSION_COOKIE, createSessionToken, verifyCsrfToken } from "@booking-os/auth";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { CsrfController } from "./csrf.controller.js";

const CSRF_KEY = Buffer.alloc(32, 9);
const NOW_MS = Date.parse("2026-08-06T07:30:00.000Z");
const PRE_AUTH_WINDOW_MS = 10 * 60 * 1000;
const HOSTNAME = "console.example.com";
const NONCE = Buffer.alloc(24, 5).toString("base64url");
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

const BASE_CONTEXT = Object.freeze({
  requestId: "request-1",
  traceId: "11111111-1111-4111-8111-111111111111",
  source: "console" as const,
});

const AUTHENTICATED_CONTEXT = Object.freeze({
  ...BASE_CONTEXT,
  actorId: "22222222-2222-4222-8222-222222222222",
  sessionId: SESSION_ID,
  authScope: { type: "platform" as const },
  sessionState: "active" as const,
  authorizationVersion: 3,
});

function derivedKey(label: string, value: string): Uint8Array {
  return createHmac("sha256", CSRF_KEY)
    .update(label, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest();
}

function responseHeaders(): {
  readonly headers: Map<string, string>;
  readonly response: { setHeader(name: string, value: string): void };
} {
  const headers = new Map<string, string>();
  return {
    headers,
    response: {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
    },
  };
}

function controller(storage: RequestContextStorage): CsrfController {
  return new CsrfController(storage, {
    csrfKey: CSRF_KEY,
    trustProxy: false,
    now: () => new Date(NOW_MS),
    createNonce: () => NONCE,
  });
}

test("issues a short-lived hostname-bound pre-auth CSRF token with private no-store", () => {
  const storage = new RequestContextStorage();
  const { headers, response } = responseHeaders();

  storage.run(BASE_CONTEXT, () => {
    const result = controller(storage).getCsrf({ headers: { host: HOSTNAME } }, response);
    const bucket = String(Math.floor(NOW_MS / PRE_AUTH_WINDOW_MS));

    assert.deepEqual(Object.keys(result), ["csrfToken"]);
    assert.equal(headers.get("cache-control"), "private, no-store");
    assert.equal(
      verifyCsrfToken({
        csrfKey: derivedKey("booking-os/csrf/pre-auth-key/v1", bucket),
        sessionId: "pre-auth",
        hostname: HOSTNAME,
        token: result.csrfToken,
      }),
      true,
    );
  });
});

test("issues authenticated CSRF from the current opaque cookie without exposing it", () => {
  const storage = new RequestContextStorage();
  const sessionToken = createSessionToken();
  const { headers, response } = responseHeaders();

  storage.run(AUTHENTICATED_CONTEXT, () => {
    const result = controller(storage).getCsrf(
      {
        headers: {
          host: HOSTNAME,
          cookie: `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
        },
      },
      response,
    );

    assert.equal(headers.get("cache-control"), "private, no-store");
    assert.equal(JSON.stringify(result).includes(sessionToken), false);
    assert.equal(
      verifyCsrfToken({
        csrfKey: derivedKey("booking-os/csrf/session-key/v1", sessionToken),
        sessionId: SESSION_ID,
        hostname: HOSTNAME,
        token: result.csrfToken,
      }),
      true,
    );
  });
});
