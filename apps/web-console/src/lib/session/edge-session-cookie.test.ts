import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken } from "@booking-os/auth";

import { readEdgeSessionToken } from "./edge-session-cookie.js";

test("reads a canonical opaque session token from the booking session cookie", () => {
  const token = createSessionToken();
  assert.equal(
    readEdgeSessionToken(`tracking=value; __Host-booking_session=${encodeURIComponent(token)}`),
    token,
  );
});

test("rejects malformed and non-canonical booking session cookie values", () => {
  assert.equal(readEdgeSessionToken("__Host-booking_session=not-a-session"), undefined);
  assert.equal(
    readEdgeSessionToken(`__Host-booking_session=${"a".repeat(24)}.${"b".repeat(42)}`),
    undefined,
  );
  assert.equal(readEdgeSessionToken(null), undefined);
});
