import assert from "node:assert/strict";
import test from "node:test";

import {
  assertPasswordPolicy,
  countPasswordCodePoints,
  MIN_PASSWORD_CODE_POINTS,
  normalizePassword,
  PasswordPolicyError,
} from "../src/password-policy.js";

test("normalizes passwords to NFC before measuring policy", () => {
  const decomposed = "Cafe\u0301-🔐-Secure";
  const normalized = normalizePassword(decomposed);

  assert.equal(normalized, "Café-🔐-Secure");
  assert.equal(countPasswordCodePoints(normalized), 13);
  assert.equal(assertPasswordPolicy(decomposed), normalized);
});

test("counts Unicode code points rather than UTF-16 code units", () => {
  assert.equal(countPasswordCodePoints("🔐".repeat(MIN_PASSWORD_CODE_POINTS)), 12);
  assert.equal(assertPasswordPolicy("🔐".repeat(MIN_PASSWORD_CODE_POINTS)).length, 24);
});

test("rejects passwords shorter than twelve Unicode code points", () => {
  assert.throws(
    () => assertPasswordPolicy("🔐".repeat(MIN_PASSWORD_CODE_POINTS - 1)),
    (error: unknown) => {
      assert.ok(error instanceof PasswordPolicyError);
      assert.equal(error.code, "too_short");
      return true;
    },
  );
});

test("rejects normalized common passwords without adding composition rules", () => {
  assert.throws(
    () => assertPasswordPolicy("Password123!"),
    (error: unknown) => {
      assert.ok(error instanceof PasswordPolicyError);
      assert.equal(error.code, "common_password");
      return true;
    },
  );

  assert.equal(
    assertPasswordPolicy("correct horse battery staple"),
    "correct horse battery staple",
  );
});

test("supports a caller-provided denylist", () => {
  assert.throws(
    () =>
      assertPasswordPolicy("TenantLaunch2026", {
        commonPasswords: new Set(["tenantlaunch2026"]),
      }),
    (error: unknown) => {
      assert.ok(error instanceof PasswordPolicyError);
      assert.equal(error.code, "common_password");
      return true;
    },
  );
});
