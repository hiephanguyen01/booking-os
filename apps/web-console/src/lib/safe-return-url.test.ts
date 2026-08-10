import assert from "node:assert/strict";
import test from "node:test";

import { resolveSafeReturnUrl } from "./safe-return-url.js";

const policy = {
  fallback: "/",
  allowedPathPrefixes: ["/platform", "/settings", "/security"],
} as const;

test("accepts allowlisted same-origin paths with query and hash", () => {
  assert.equal(
    resolveSafeReturnUrl("/platform/tenants?page=2#active", policy),
    "/platform/tenants?page=2#active",
  );
  assert.equal(resolveSafeReturnUrl("/settings", policy), "/settings");
});

test("rejects external, protocol-relative, and non-allowlisted return URLs", () => {
  for (const value of [
    "https://evil.example/phish",
    "//evil.example/phish",
    "/\\evil.example/phish",
    "javascript:alert(1)",
    "/login",
    "/platform-admin",
  ]) {
    assert.equal(resolveSafeReturnUrl(value, policy), "/", value);
  }
});

test("rejects control characters and malformed encoded paths", () => {
  for (const value of ["/platform\n/tenants", "/platform/%", "/platform/%0d%0aLocation:evil"]) {
    assert.equal(resolveSafeReturnUrl(value, policy), "/", value);
  }
});

test("uses the fallback for empty input", () => {
  assert.equal(resolveSafeReturnUrl(undefined, policy), "/");
  assert.equal(resolveSafeReturnUrl(null, policy), "/");
  assert.equal(resolveSafeReturnUrl("", policy), "/");
});
