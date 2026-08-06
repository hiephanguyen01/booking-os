import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionToken,
  deriveSessionSecretDigest,
  parseSessionToken,
  SESSION_SECRET_BYTES,
  SESSION_SELECTOR_BYTES,
  verifySessionSecretDigest,
} from "../src/opaque-session.js";

const digestKey = Buffer.alloc(32, 0xa5);

test("creates a selector.secret token with independent required entropy", () => {
  const requestedSizes: number[] = [];
  const token = createSessionToken({
    randomBytes(size) {
      requestedSizes.push(size);
      return Buffer.alloc(size, requestedSizes.length);
    },
  });
  const parsed = parseSessionToken(token);

  assert.deepEqual(requestedSizes, [SESSION_SELECTOR_BYTES, SESSION_SECRET_BYTES]);
  assert.notEqual(parsed, null);
  assert.equal(Buffer.from(parsed?.selector ?? "", "base64url").byteLength, SESSION_SELECTOR_BYTES);
  assert.equal(Buffer.from(parsed?.secret ?? "", "base64url").byteLength, SESSION_SECRET_BYTES);
});

test("parser rejects malformed or non-canonical session tokens", () => {
  const valid = createSessionToken({ randomBytes: (size) => Buffer.alloc(size, 7) });
  const [selector, secret] = valid.split(".");

  assert.equal(parseSessionToken(valid)?.selector, selector);
  for (const candidate of [
    "",
    ` ${valid}`,
    `${valid} `,
    `${selector}.${secret}.extra`,
    `${selector}.`,
    `.${secret}`,
    `${selector}.${secret}=`,
    "plain-token",
  ]) {
    assert.equal(parseSessionToken(candidate), null, candidate);
  }
});

test("derives and verifies only an HMAC digest of the session secret", () => {
  const token = createSessionToken({ randomBytes: (size) => Buffer.alloc(size, 9) });
  const parsed = parseSessionToken(token);
  assert.notEqual(parsed, null);

  const digest = deriveSessionSecretDigest({ digestKey, secret: parsed?.secret ?? "" });
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest.includes(parsed?.secret ?? "missing"), false);
  assert.equal(
    verifySessionSecretDigest({
      digestKey,
      secret: parsed?.secret ?? "",
      expectedDigest: digest,
    }),
    true,
  );
  assert.equal(
    verifySessionSecretDigest({
      digestKey,
      secret: createSessionToken().split(".")[1] ?? "",
      expectedDigest: digest,
    }),
    false,
  );
});
