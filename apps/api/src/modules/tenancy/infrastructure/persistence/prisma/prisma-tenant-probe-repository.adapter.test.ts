import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@prisma/client";

import { PrismaTenantProbeRepositoryAdapter } from "./prisma-tenant-probe-repository.adapter.js";

test("lists tenant probes through the active transaction", async () => {
  const queries: unknown[] = [];
  const expected = [
    {
      id: "550e8400-e29b-41d4-a716-446655440010",
      tenantId: "550e8400-e29b-41d4-a716-446655440001",
      value: "visible-to-a",
    },
  ];
  const transaction = {
    tenantProbe: {
      async findMany(query: unknown) {
        queries.push(query);
        return expected;
      },
    },
  } as unknown as Prisma.TransactionClient;
  const adapter = new PrismaTenantProbeRepositoryAdapter(transaction);

  const result = await adapter.list();

  assert.equal(result, expected);
  assert.deepEqual(queries, [
    {
      orderBy: { id: "asc" },
      select: { id: true, tenantId: true, value: true },
    },
  ]);
});
