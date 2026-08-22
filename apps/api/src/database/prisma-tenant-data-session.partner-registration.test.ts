import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@prisma/client";

import { PrismaTenantDataSessionFactory } from "./prisma-tenant-data-session.factory.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";

test("tenant data session exposes the transaction-bound Partner registration challenge repository", () => {
  const factory = new PrismaTenantDataSessionFactory();
  const session = factory.create({} as Prisma.TransactionClient, TENANT_ID);

  assert.ok(
    session.partnerRegistrationChallenges,
    "tenant transaction must expose Partner registration challenge persistence",
  );
});
