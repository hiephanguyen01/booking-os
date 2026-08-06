import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionExpiry,
  isSessionExpired,
  refreshSessionTouch,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_IDLE_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
  shouldTouchSession,
} from "../src/session-expiry.js";

const now = new Date("2026-08-06T00:00:00.000Z");

test("creates seven-day idle and thirty-day absolute expiry", () => {
  const expiry = createSessionExpiry(now);
  assert.equal(expiry.idleExpiresAt.getTime() - now.getTime(), SESSION_IDLE_TTL_MS);
  assert.equal(expiry.absoluteExpiresAt.getTime() - now.getTime(), SESSION_ABSOLUTE_TTL_MS);
  assert.equal(
    isSessionExpired({
      now,
      idleExpiresAt: expiry.idleExpiresAt,
      absoluteExpiresAt: expiry.absoluteExpiresAt,
    }),
    false,
  );
  assert.equal(
    isSessionExpired({
      now: expiry.idleExpiresAt,
      idleExpiresAt: expiry.idleExpiresAt,
      absoluteExpiresAt: expiry.absoluteExpiresAt,
    }),
    true,
  );
});

test("coalesces touch writes to once per five minutes", () => {
  assert.equal(
    shouldTouchSession({
      now: new Date(now.getTime() + SESSION_TOUCH_INTERVAL_MS - 1),
      lastSeenAt: now,
    }),
    false,
  );
  assert.equal(
    shouldTouchSession({
      now: new Date(now.getTime() + SESSION_TOUCH_INTERVAL_MS),
      lastSeenAt: now,
    }),
    true,
  );
});

test("touch refresh never extends beyond absolute expiry", () => {
  const absoluteExpiresAt = new Date(now.getTime() + 60 * 60 * 1000);
  const touched = refreshSessionTouch({ now, absoluteExpiresAt });
  assert.equal(touched.idleExpiresAt.toISOString(), absoluteExpiresAt.toISOString());
});
