import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";
import { TenancyModule } from "./tenancy.module.js";
import { TENANT_TRANSACTION_PORT } from "./tenancy.tokens.js";

test("TenancyModule exports the tenant transaction boundary for cross-module workflows", () => {
  const exports = (Reflect.getMetadata("exports", TenancyModule) ?? []) as readonly unknown[];

  assert.ok(exports.includes(TENANT_TRANSACTION_PORT));
});
