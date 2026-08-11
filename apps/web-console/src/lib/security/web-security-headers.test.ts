import assert from "node:assert/strict";
import test from "node:test";

import nextConfig from "../../../next.config.js";

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const AUTH_PAGE_SOURCES = ["/login", "/activate/:path*", "/password/:path*", "/invite/:path*"];

type HeaderValue = {
  readonly key: string;
  readonly value: string;
};

type HeaderRule = {
  readonly source: string;
  readonly headers: readonly HeaderValue[];
};

test("auth pages declare restrictive no-store response headers", async () => {
  assert.equal(typeof nextConfig.headers, "function");
  assert.ok(nextConfig.headers);

  const rules = (await nextConfig.headers()) as readonly HeaderRule[];

  for (const source of AUTH_PAGE_SOURCES) {
    const rule = rules.find((candidate) => candidate.source === source);
    assert.ok(rule, `missing auth-page header rule for ${source}`);

    const headers = Object.fromEntries(
      rule.headers.map((header) => [header.key.toLowerCase(), header.value]),
    );

    assert.equal(headers["content-security-policy"], CONTENT_SECURITY_POLICY, source);
    assert.equal(headers["referrer-policy"], "no-referrer", source);
    assert.equal(headers["x-content-type-options"], "nosniff", source);
    assert.equal(headers["x-frame-options"], "DENY", source);
    assert.equal(headers["permissions-policy"], "camera=(), geolocation=(), microphone=()", source);
    assert.equal(headers["cache-control"], "no-store", source);
  }
});
