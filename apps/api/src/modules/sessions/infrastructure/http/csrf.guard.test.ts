import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import { BOOKING_SESSION_COOKIE, createSessionToken, deriveCsrfToken } from "@booking-os/auth";
import type { ExecutionContext } from "@nestjs/common";
import { ForbiddenException } from "@nestjs/common";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { CsrfGuard } from "./csrf.guard.js";

const CSRF_KEY = Buffer.alloc(32, 7);
const NOW_MS = Date.parse("2026-08-06T07:00:00.000Z");
const PRE_AUTH_WINDOW_MS = 10 * 60 * 1000;
const HOSTNAME = "console.example.com";
const ORIGIN = `https://${HOSTNAME}`;
const NONCE = Buffer.alloc(24, 3).toString("base64url");
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
});

function derivedKey(label: string, value: string): Uint8Array {
  return createHmac("sha256", CSRF_KEY)
    .update(label, "utf8")
    .update("\0", "utf8")
    .update(value, "utf8")
    .digest();
}

function sessionCsrfToken(sessionToken: string, hostname = HOSTNAME): string {
  return deriveCsrfToken({
    csrfKey: derivedKey("booking-os/csrf/session-key/v1", sessionToken),
    sessionId: SESSION_ID,
    hostname,
    nonce: NONCE,
  });
}

function preAuthCsrfToken(nowMs: number, hostname = HOSTNAME): string {
  const bucket = String(Math.floor(nowMs / PRE_AUTH_WINDOW_MS));
  return deriveCsrfToken({
    csrfKey: derivedKey("booking-os/csrf/pre-auth-key/v1", bucket),
    sessionId: "pre-auth",
    hostname,
    nonce: NONCE,
  });
}

function executionContext(input: {
  readonly method?: string;
  readonly host?: string;
  readonly origin?: string;
  readonly csrfToken?: string;
  readonly sessionToken?: string;
}): ExecutionContext {
  const headers: Record<string, string> = {};
  if (input.host !== undefined) headers.host = input.host;
  if (input.origin !== undefined) headers.origin = input.origin;
  if (input.csrfToken !== undefined) headers["x-csrf-token"] = input.csrfToken;
  if (input.sessionToken !== undefined) {
    headers.cookie = `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(input.sessionToken)}`;
  }

  return {
    switchToHttp: () => ({
      getRequest: () => ({ method: input.method ?? "POST", headers }),
    }),
  } as unknown as ExecutionContext;
}

function guard(storage: RequestContextStorage): CsrfGuard {
  return new CsrfGuard(storage, {
    allowedOrigins: [ORIGIN, "https://storefront.example.com:8443"],
    csrfKey: CSRF_KEY,
    trustProxy: false,
    now: () => new Date(NOW_MS),
  });
}

test("accepts an unsafe authenticated request only with exact origin and current-cookie CSRF binding", () => {
  const storage = new RequestContextStorage();
  const sessionToken = createSessionToken();
  const csrfToken = sessionCsrfToken(sessionToken);

  storage.run(AUTHENTICATED_CONTEXT, () => {
    assert.equal(
      guard(storage).canActivate(
        executionContext({
          host: HOSTNAME,
          origin: ORIGIN,
          csrfToken,
          sessionToken,
        }),
      ),
      true,
    );
  });
});

test("rejects authenticated CSRF replay after the opaque session cookie rotates", () => {
  const storage = new RequestContextStorage();
  const previousSessionToken = createSessionToken();
  const replacementSessionToken = createSessionToken();
  const previousCsrfToken = sessionCsrfToken(previousSessionToken);

  storage.run(AUTHENTICATED_CONTEXT, () => {
    assert.throws(
      () =>
        guard(storage).canActivate(
          executionContext({
            host: HOSTNAME,
            origin: ORIGIN,
            csrfToken: previousCsrfToken,
            sessionToken: replacementSessionToken,
          }),
        ),
      ForbiddenException,
    );
  });
});

test("accepts recent pre-auth CSRF only for the exact request hostname and origin", () => {
  const storage = new RequestContextStorage();
  const csrfToken = preAuthCsrfToken(NOW_MS);

  storage.run(BASE_CONTEXT, () => {
    assert.equal(
      guard(storage).canActivate(executionContext({ host: HOSTNAME, origin: ORIGIN, csrfToken })),
      true,
    );

    assert.throws(
      () =>
        guard(storage).canActivate(
          executionContext({
            host: HOSTNAME,
            origin: "https://storefront.example.com:8443",
            csrfToken,
          }),
        ),
      ForbiddenException,
    );

    assert.throws(
      () =>
        guard(storage).canActivate(
          executionContext({
            host: "storefront.example.com:8443",
            origin: "https://storefront.example.com:8443",
            csrfToken,
          }),
        ),
      ForbiddenException,
    );
  });
});

test("rejects expired pre-auth CSRF and bypasses validation for safe methods", () => {
  const storage = new RequestContextStorage();
  const expired = preAuthCsrfToken(NOW_MS - PRE_AUTH_WINDOW_MS * 2);

  storage.run(BASE_CONTEXT, () => {
    assert.throws(
      () =>
        guard(storage).canActivate(
          executionContext({ host: HOSTNAME, origin: ORIGIN, csrfToken: expired }),
        ),
      ForbiddenException,
    );

    assert.equal(
      guard(storage).canActivate(executionContext({ method: "GET", host: HOSTNAME })),
      true,
    );
  });
});
