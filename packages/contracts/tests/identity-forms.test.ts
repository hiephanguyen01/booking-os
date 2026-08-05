import assert from "node:assert/strict";
import test from "node:test";

import { forgotPasswordFormSchema, passwordCommandFormSchema } from "../src/identity/index.js";

test("normalizes valid email and emits stable email codes", () => {
  assert.deepEqual(forgotPasswordFormSchema.parse({ email: " User@Example.Test " }), {
    email: "user@example.test",
  });

  const empty = forgotPasswordFormSchema.safeParse({ email: "" });
  assert.equal(empty.success, false);
  if (!empty.success) assert.equal(empty.error.issues[0]?.message, "REQUIRED");

  const malformed = forgotPasswordFormSchema.safeParse({ email: "not-an-email" });
  assert.equal(malformed.success, false);
  if (!malformed.success) assert.equal(malformed.error.issues[0]?.message, "INVALID_EMAIL");
});

test("emits stable password validation codes", () => {
  const short = passwordCommandFormSchema.safeParse({
    newPassword: "short",
    confirmation: "short",
  });
  assert.equal(short.success, false);
  if (!short.success) assert.equal(short.error.issues[0]?.message, "PASSWORD_TOO_SHORT");

  const mismatch = passwordCommandFormSchema.safeParse({
    newPassword: "Long-enough-password-123!",
    confirmation: "Different-password-123!",
  });
  assert.equal(mismatch.success, false);
  if (!mismatch.success) {
    const issue = mismatch.error.issues.at(-1);
    assert.equal(issue?.message, "PASSWORD_CONFIRMATION_MISMATCH");
    assert.deepEqual(issue?.path, ["confirmation"]);
  }
});
