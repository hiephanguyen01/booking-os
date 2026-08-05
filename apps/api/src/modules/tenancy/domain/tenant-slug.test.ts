import assert from "node:assert/strict";
import test from "node:test";

import { tenantSlugFromHostname } from "./tenant-slug.js";

test("extracts a normalized tenant slug", () => {
  assert.equal(tenantSlugFromHostname("tenant-a.example.com", "example.com"), "tenant-a");
  assert.equal(tenantSlugFromHostname("TENANT-A.EXAMPLE.COM", "EXAMPLE.COM"), "tenant-a");
});

test("rejects malformed and non-tenant hostnames", () => {
  assert.equal(tenantSlugFromHostname("-invalid.example.com", "example.com"), undefined);
  assert.equal(tenantSlugFromHostname("127.0.0.1", "example.com"), undefined);
  assert.equal(tenantSlugFromHostname("localhost", "example.com"), undefined);
});

test("rejects tenant slugs on an unconfigured parent domain", () => {
  assert.equal(tenantSlugFromHostname("tenant-a.attacker.test", "example.com"), undefined);
  assert.equal(tenantSlugFromHostname("tenant-a.eu.example.com", "example.com"), undefined);
});
