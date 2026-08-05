import assert from "node:assert/strict";
import test from "node:test";

import {
  createOneTimeToken,
  parseOneTimeToken,
  verifyOneTimeTokenSecret,
} from "../src/one-time-token.js";

const PEPPER = new Uint8Array(32).fill(7);

function deterministicRandomBytes(size: number): Uint8Array {
  const offset = size === 16 ? 1 : 101;
  return Uint8Array.from({ length: size }, (_, index) => (offset + index) % 256);
}

test("creates selector and secret with independent entropy", () => {
  const token = createOneTimeToken({
    pepper: PEPPER,
    purpose: "password_reset",
    randomBytes: deterministicRandomBytes,
  });

  assert.equal(token.selector.length, 22);
  assert.equal(token.secret.length, 43);
  assert.equal(token.serialized, `${token.selector}.${token.secret}`);
  assert.equal(token.secretDigest.length, 64);
  assert.equal(token.secretDigest.includes(token.secret), false);
  assert.deepEqual(parseOneTimeToken(token.serialized), {
    selector: token.selector,
    secret: token.secret,
  });
});

test("binds the secret digest to its purpose and pepper", () => {
  const token = createOneTimeToken({
    pepper: PEPPER,
    purpose: "account_activation",
    randomBytes: deterministicRandomBytes,
  });

  assert.equal(
    verifyOneTimeTokenSecret({
      pepper: PEPPER,
      purpose: "account_activation",
      secret: token.secret,
      expectedDigest: token.secretDigest,
    }),
    true,
  );
  assert.equal(
    verifyOneTimeTokenSecret({
      pepper: PEPPER,
      purpose: "password_reset",
      secret: token.secret,
      expectedDigest: token.secretDigest,
    }),
    false,
  );
  assert.equal(
    verifyOneTimeTokenSecret({
      pepper: new Uint8Array(32).fill(8),
      purpose: "account_activation",
      secret: token.secret,
      expectedDigest: token.secretDigest,
    }),
    false,
  );
});

test("rejects malformed tokens and digests without throwing", () => {
  const token = createOneTimeToken({
    pepper: PEPPER,
    purpose: "membership_invitation",
    randomBytes: deterministicRandomBytes,
  });

  for (const serialized of ["", token.selector, `${token.selector}.`, `.${token.secret}`, "a.b.c"]) {
    assert.equal(parseOneTimeToken(serialized), null);
  }

  for (const expectedDigest of ["", "not-hex", "00", "0".repeat(64)]) {
    assert.equal(
      verifyOneTimeTokenSecret({
        pepper: PEPPER,
        purpose: "membership_invitation",
        secret: `${token.secret}tampered`,
        expectedDigest,
      }),
      false,
    );
  }
});

test("uses fresh entropy by default and rejects weak inputs", () => {
  const first = createOneTimeToken({ pepper: PEPPER, purpose: "password_reset" });
  const second = createOneTimeToken({ pepper: PEPPER, purpose: "password_reset" });

  assert.notEqual(first.serialized, second.serialized);
  assert.throws(
    () => createOneTimeToken({ pepper: new Uint8Array(31), purpose: "password_reset" }),
    RangeError,
  );
  assert.throws(() => createOneTimeToken({ pepper: PEPPER, purpose: "" }), TypeError);
});
