import assert from "node:assert/strict";
import test from "node:test";

import { tenantSlugFromHostname } from "./tenant-slug.js";

test("extracts a normalized tenant slug", () => {
  assert.equal(tenantSlugFromHostname("tenant-a.example.com"), "tenant-a");
  assert.equal(tenantSlugFromHostname("TENANT-A.EXAMPLE.COM"), "tenant-a");
});

test("rejects malformed and non-tenant hostnames", () => {
  assert.equal(tenantSlugFromHostname("-invalid.example.com"), undefined);
  assert.equal(tenantSlugFromHostname("127.0.0.1"), undefined);
  assert.equal(tenantSlugFromHostname("localhost"), undefined);
});
