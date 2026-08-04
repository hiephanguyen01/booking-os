import assert from "node:assert/strict";
import test from "node:test";

import { assertTenantId, isTenantId } from "./tenant-id.js";

test("accepts an RFC-4122 tenant UUID", () => {
  const tenantId = "550e8400-e29b-41d4-a716-446655440000";

  assert.equal(isTenantId(tenantId), true);
  assert.doesNotThrow(() => assertTenantId(tenantId));
});

test("rejects a malformed tenant ID", () => {
  assert.equal(isTenantId("tenant-a"), false);
  assert.throws(() => assertTenantId("tenant-a"), TypeError);
});
