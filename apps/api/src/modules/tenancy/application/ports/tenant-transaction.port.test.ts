import assert from "node:assert/strict";
import test from "node:test";

import type {
  TenantDataSession,
  TenantTransactionPort,
} from "./tenant-transaction.port.js";
import type { TenantProbeRepositoryPort } from "./tenant-probe-repository.port.js";

const tenantProbes: TenantProbeRepositoryPort = {
  async list() {
    return [];
  },
};
const session: TenantDataSession = { tenantProbes };
const transaction: TenantTransactionPort = {
  async run(_context, work) {
    return work(session);
  },
};

test("runs work through technology-neutral capabilities", async () => {
  const result = await transaction.run(
    {
      requestId: "req-1",
      traceId: "550e8400-e29b-41d4-a716-446655440000",
      source: "internal",
      tenantId: "550e8400-e29b-41d4-a716-446655440001",
    },
    (current) => current.tenantProbes.list(),
  );

  assert.deepEqual(result, []);
});
