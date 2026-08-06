import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionTokenOverlap,
  decideSessionTokenSuccessor,
  getSessionTokenDisposition,
  SESSION_ROTATION_AGE_MS,
  SESSION_TOKEN_OVERLAP_MS,
  shouldRotateSessionToken,
} from "../src/session-rotation.js";

const issuedAt = new Date("2026-08-06T00:00:00.000Z");
const farFuture = new Date("2026-09-01T00:00:00.000Z");

test("rotates at fifteen-minute age and immediately for security events", () => {
  assert.equal(
    shouldRotateSessionToken({
      issuedAt,
      now: new Date(issuedAt.getTime() + SESSION_ROTATION_AGE_MS - 1),
    }),
    false,
  );
  assert.equal(
    shouldRotateSessionToken({
      issuedAt,
      now: new Date(issuedAt.getTime() + SESSION_ROTATION_AGE_MS),
    }),
    true,
  );
  assert.equal(
    shouldRotateSessionToken({ issuedAt, now: issuedAt, reason: "credential_change" }),
    true,
  );
});

test("classifies active, overlap, reuse, expired, and revoked tokens", () => {
  const replacement = createSessionTokenOverlap(issuedAt);
  assert.equal(replacement.overlapUntil.getTime() - issuedAt.getTime(), SESSION_TOKEN_OVERLAP_MS);

  const common = {
    sessionState: "active" as const,
    idleExpiresAt: farFuture,
    absoluteExpiresAt: farFuture,
    tokenExpiresAt: farFuture,
  };
  assert.equal(getSessionTokenDisposition({ ...common, now: issuedAt }), "active");
  assert.equal(
    getSessionTokenDisposition({ ...common, now: replacement.overlapUntil, ...replacement }),
    "overlap",
  );
  assert.equal(
    getSessionTokenDisposition({
      ...common,
      now: new Date(replacement.overlapUntil.getTime() + 1),
      ...replacement,
    }),
    "reuse",
  );
  assert.equal(getSessionTokenDisposition({ ...common, now: farFuture }), "expired");
  assert.equal(
    getSessionTokenDisposition({ ...common, now: issuedAt, sessionState: "compromised" }),
    "revoked",
  );
});

test("concurrent rotation returns the one existing successor during overlap", () => {
  const replacement = createSessionTokenOverlap(issuedAt);
  assert.deepEqual(decideSessionTokenSuccessor({ now: issuedAt }), { action: "issue" });
  assert.deepEqual(
    decideSessionTokenSuccessor({
      now: issuedAt,
      ...replacement,
      successorTokenId: "token-next",
    }),
    { action: "return_existing", successorTokenId: "token-next" },
  );
  assert.deepEqual(
    decideSessionTokenSuccessor({
      now: new Date(replacement.overlapUntil.getTime() + 1),
      ...replacement,
      successorTokenId: "token-next",
    }),
    { action: "compromise" },
  );
});
