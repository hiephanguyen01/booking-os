import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken } from "@booking-os/auth";

import {
  BOOKING_OS_SESSION_COOKIE,
  readSessionToken,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from "./session-cookie.js";

test("web console uses the authoritative host-only opaque session cookie contract", () => {
  const token = createSessionToken();
  const serialized = serializeSessionCookie(token, "test");

  assert.equal(BOOKING_OS_SESSION_COOKIE, "__Host-booking_session");
  assert.equal(SESSION_COOKIE_MAX_AGE_SECONDS, 60 * 60 * 24 * 30);
  assert.equal(
    serialized,
    `__Host-booking_session=${encodeURIComponent(token)}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}`,
  );
  assert.equal(serialized.includes("Domain="), false);
  assert.equal(
    readSessionToken(`other=value; __Host-booking_session=${encodeURIComponent(token)}`),
    token,
  );
});

test("web console expires the same secure host-only cookie and rejects malformed tokens", () => {
  assert.equal(
    serializeExpiredSessionCookie(),
    "__Host-booking_session=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0",
  );
  assert.equal(readSessionToken("__Host-booking_session=not-an-opaque-token"), undefined);
});
