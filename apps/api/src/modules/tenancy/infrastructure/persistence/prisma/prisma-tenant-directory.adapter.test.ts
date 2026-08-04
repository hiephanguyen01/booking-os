import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import { PrismaTenantDirectoryAdapter } from "./prisma-tenant-directory.adapter.js";

test("maps tenant slug lookup to the global tenant table", async () => {
  const queries: unknown[] = [];
  const expected = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    slug: "tenant-a",
  };
  const prisma = {
    tenant: {
      async findUnique(query: unknown) {
        queries.push(query);
        return expected;
      },
    },
  } as unknown as PrismaService;
  const adapter = new PrismaTenantDirectoryAdapter(prisma);

  const result = await adapter.findActiveBySlug("tenant-a");

  assert.equal(result, expected);
  assert.deepEqual(queries, [
    {
      where: { slug: "tenant-a" },
      select: { id: true, slug: true },
    },
  ]);
});
