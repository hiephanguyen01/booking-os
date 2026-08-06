import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken } from "../src/opaque-session.js";
import {
  BOOKING_SESSION_COOKIE,
  readSessionToken,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
  SESSION_COOKIE_MAX_AGE_SECONDS,
} from "../src/session-cookie.js";

const token = createSessionToken({ randomBytes: (size) => Buffer.alloc(size, 4) });

test("serializes the exact __Host- session cookie contract", () => {
  assert.equal(
    serializeSessionCookie(token),
    `${BOOKING_SESSION_COOKIE}=${token}; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=${String(
      SESSION_COOKIE_MAX_AGE_SECONDS,
    )}`,
  );
  assert.equal(serializeSessionCookie(token).includes("Domain="), false);
});

test("expired cookie preserves __Host- security attributes", () => {
  assert.equal(
    serializeExpiredSessionCookie(),
    `${BOOKING_SESSION_COOKIE}=; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`,
  );
});

test("reads only a valid opaque token from the exact cookie name", () => {
  assert.equal(readSessionToken(`theme=dark; ${BOOKING_SESSION_COOKIE}=${token}`), token);
  assert.equal(readSessionToken(`booking_session=${token}`), undefined);
  assert.equal(readSessionToken(`${BOOKING_SESSION_COOKIE}=not-a-token`), undefined);
});
