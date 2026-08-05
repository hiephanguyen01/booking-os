import assert from "node:assert/strict";
import test from "node:test";

import type { TenantExecutionContext } from "@booking-os/contracts";

import type { TenantTransactionPort } from "../ports/tenant-transaction.port.js";
import { ListTenantProbesUseCase } from "./list-tenant-probes.use-case.js";

test("forwards exact context and returns repository records", async () => {
  const context: TenantExecutionContext = {
    requestId: "req-1",
    traceId: "550e8400-e29b-41d4-a716-446655440000",
    source: "internal",
    tenantId: "550e8400-e29b-41d4-a716-446655440001",
  };
  const expected = [
    {
      id: "550e8400-e29b-41d4-a716-446655440010",
      tenantId: context.tenantId,
      value: "visible-to-a",
    },
  ];
  let observed: TenantExecutionContext | undefined;
  const transactions: TenantTransactionPort = {
    async run(current, work) {
      observed = current;
      return work({
        tenantProbes: {
          async list() {
            return expected;
          },
        },
      });
    },
  };
  const useCase = new ListTenantProbesUseCase(transactions);

  const result = await useCase.execute(context);

  assert.equal(observed, context);
  assert.equal(result, expected);
});
