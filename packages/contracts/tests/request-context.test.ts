import assert from "node:assert/strict";
import test from "node:test";

import type { RequestContext, TenantExecutionContext } from "../src/request-context.js";

test("tenant execution context is assignable to request context", () => {
  const tenant: TenantExecutionContext = {
    requestId: "req-1",
    traceId: "00000000-0000-4000-8000-000000000001",
    source: "internal",
    tenantId: "00000000-0000-4000-8000-000000000001",
  };
  const request: RequestContext = tenant;

  assert.equal(request.source, "internal");
  assert.equal(request.tenantId, tenant.tenantId);
});
