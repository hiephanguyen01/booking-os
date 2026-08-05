import assert from "node:assert/strict";
import test from "node:test";

import { normalizeEmail } from "../src/email-normalization.js";

test("normalizes email with trim, Unicode NFC, and lowercase", () => {
  assert.equal(normalizeEmail("  Us\u0065\u0301r+Pilot@Example.COM  "), "usér+pilot@example.com");
});

test("preserves dots and plus tags", () => {
  assert.equal(
    normalizeEmail("First.Last+Partner.Onboarding@Example.COM"),
    "first.last+partner.onboarding@example.com",
  );
});

test("rejects an empty normalized email", () => {
  assert.throws(() => normalizeEmail(" \t\n "), TypeError);
});
