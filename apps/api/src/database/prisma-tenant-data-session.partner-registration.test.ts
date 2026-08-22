import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@prisma/client";

import type { PartnerRegistrationChallengeRepositoryPort } from "../modules/partners/application/ports/partner-registration-challenge-repository.port.js";
import type { TenantDataSession } from "../modules/tenancy/application/ports/tenant-transaction.port.js";
import { PrismaTenantDataSessionFactory } from "./prisma-tenant-data-session.factory.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const DIGEST_KEY = new Uint8Array(32).fill(7);

interface FactoryOptions {
  readonly digestKey: Uint8Array;
}

type FactoryConstructor = new (options: FactoryOptions) => PrismaTenantDataSessionFactory;

test("tenant data session exposes the transaction-bound Partner registration challenge repository", () => {
  const Factory = PrismaTenantDataSessionFactory as unknown as FactoryConstructor;
  const factory = new Factory({ digestKey: DIGEST_KEY });
  const session = factory.create({} as Prisma.TransactionClient, TENANT_ID) as TenantDataSession & {
    readonly partnerRegistrationChallenges?: PartnerRegistrationChallengeRepositoryPort;
  };

  assert.ok(
    session.partnerRegistrationChallenges,
    "tenant transaction must expose Partner registration challenge persistence",
  );
});
