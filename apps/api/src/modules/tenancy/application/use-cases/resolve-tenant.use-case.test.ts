import assert from "node:assert/strict";
import test from "node:test";

import type { TenantDirectoryPort } from "../ports/tenant-directory.port.js";
import { ResolveTenantUseCase } from "./resolve-tenant.use-case.js";

test("resolves a valid hostname through the directory port", async () => {
  const calls: string[] = [];
  const expected = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    slug: "tenant-a",
  };
  const directory: TenantDirectoryPort = {
    async findActiveBySlug(slug) {
      calls.push(slug);
      return expected;
    },
  };
  const useCase = new ResolveTenantUseCase(directory);

  const result = await useCase.execute("tenant-a.example.com");

  assert.equal(result, expected);
  assert.deepEqual(calls, ["tenant-a"]);
});

test("does not query the directory for an invalid hostname", async () => {
  let calls = 0;
  const directory: TenantDirectoryPort = {
    async findActiveBySlug() {
      calls += 1;
      return null;
    },
  };
  const useCase = new ResolveTenantUseCase(directory);

  const result = await useCase.execute("localhost");

  assert.equal(result, null);
  assert.equal(calls, 0);
});
