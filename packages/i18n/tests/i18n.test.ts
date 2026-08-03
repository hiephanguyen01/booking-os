import assert from "node:assert/strict";
import test from "node:test";

import { getMessage, normalizeLocale } from "../src/index.js";

test("normalizes supported locale codes", () => {
  assert.equal(normalizeLocale("vi"), "vi");
  assert.equal(normalizeLocale("en-US"), "en");
  assert.equal(normalizeLocale("EN-gb"), "en");
});

test("falls back to Vietnamese for unsupported or missing locale", () => {
  assert.equal(normalizeLocale("fr"), "vi");
  assert.equal(normalizeLocale(null), "vi");
  assert.equal(normalizeLocale(undefined), "vi");
});

test("returns typed English storefront message", () => {
  assert.equal(getMessage("en", "storefront.title"), "Booking storefront");
});

test("returns typed Vietnamese console message", () => {
  assert.equal(getMessage("vi", "console.title"), "Bảng điều khiển Booking OS");
});
