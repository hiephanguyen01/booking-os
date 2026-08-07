import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import type { RequestContext, TenantExecutionContext } from "@booking-os/contracts";

import { RequestContextStorage } from "../src/common/request-context/request-context.storage.js";
import type { Environment } from "../src/config/environment.schema.js";
import { EnvironmentService } from "../src/config/environment.service.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { PrismaTenantDataSessionFactory } from "../src/database/prisma-tenant-data-session.factory.js";
import { requireTenantExecutionContext } from "../src/modules/tenancy/application/tenant-execution-context.js";
import { PrismaTenantTransactionAdapter } from "../src/modules/tenancy/infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.js";
import { runTenantTestTransaction } from "./support/tenant-test-transaction.js";

const TENANT_A_ID = "55555555-5555-4555-8555-555555555555";
const TENANT_B_ID = "66666666-6666-4666-8666-666666666666";

const testEnvironment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  trustProxy: false,
  tenantBaseDomain: "example.com",
  port: 3101,
  apiPrefix: "api",
  appVersion: "0.1.0-e2e",
  logLevel: "error",
  databaseUrl:
    process.env.DATABASE_URL ?? "postgresql://booking:booking@localhost:5432/booking_os_test",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379/1",
  readinessTimeoutMs: 750,
  sessionSecret: "test-only-session-secret-at-least-32-characters",
  paymentProvider: "mock",
};

let prisma: PrismaService;
let transactions: PrismaTenantTransactionAdapter;
let requestContext: RequestContextStorage;

function contextFor(index: number, tenantId: string): RequestContext {
  return {
    requestId: `concurrency-${index}`,
    traceId: `77777777-7777-4777-8777-${String(index).padStart(12, "0")}`,
    source: "internal",
    tenantId,
  };
}

function crossAsyncBoundary(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function listWithinRequest(context: RequestContext): Promise<readonly string[]> {
  return requestContext.run(context, async () => {
    await crossAsyncBoundary();
    const tenantContext: TenantExecutionContext = requireTenantExecutionContext(
      requestContext.require(),
    );

    return transactions.run(tenantContext, async (session) => {
      await crossAsyncBoundary();
      const rows = await session.tenantProbes.list();
      return rows.map((row) => `${row.tenantId}:${row.value}`);
    });
  });
}

before(async () => {
  prisma = new PrismaService(new EnvironmentService(testEnvironment));
  transactions = new PrismaTenantTransactionAdapter(prisma, new PrismaTenantDataSessionFactory());
  requestContext = new RequestContextStorage();

  await prisma.$connect();
  await prisma.tenant.upsert({
    where: { id: TENANT_A_ID },
    update: { slug: "concurrency-a", name: "Concurrency A" },
    create: { id: TENANT_A_ID, slug: "concurrency-a", name: "Concurrency A" },
  });
  await prisma.tenant.upsert({
    where: { id: TENANT_B_ID },
    update: { slug: "concurrency-b", name: "Concurrency B" },
    create: { id: TENANT_B_ID, slug: "concurrency-b", name: "Concurrency B" },
  });
  await runTenantTestTransaction(prisma, TENANT_A_ID, async (transaction) => {
    await transaction.tenantProbe.deleteMany();
    await transaction.tenantProbe.create({
      data: { tenantId: TENANT_A_ID, value: "concurrency-visible-to-a" },
    });
  });
  await runTenantTestTransaction(prisma, TENANT_B_ID, async (transaction) => {
    await transaction.tenantProbe.deleteMany();
    await transaction.tenantProbe.create({
      data: { tenantId: TENANT_B_ID, value: "concurrency-visible-to-b" },
    });
  });
});

after(async () => {
  await runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.deleteMany(),
  );
  await runTenantTestTransaction(prisma, TENANT_B_ID, (transaction) =>
    transaction.tenantProbe.deleteMany(),
  );
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A_ID, TENANT_B_ID] } } });
  await prisma.$disconnect();
});

test("parallel tenant requests do not leak request or transaction context", async () => {
  const operations = Array.from({ length: 24 }, async (_, index) => {
    const tenantId = index % 2 === 0 ? TENANT_A_ID : TENANT_B_ID;
    const expectedValue =
      tenantId === TENANT_A_ID ? "concurrency-visible-to-a" : "concurrency-visible-to-b";
    const rows = await listWithinRequest(contextFor(index, tenantId));

    assert.deepEqual(rows, [`${tenantId}:${expectedValue}`]);
  });

  await Promise.all(operations);
  assert.equal(requestContext.get(), undefined);
});

test("sequential tenant A then B then missing context has no leakage", async () => {
  assert.deepEqual(await listWithinRequest(contextFor(100, TENANT_A_ID)), [
    `${TENANT_A_ID}:concurrency-visible-to-a`,
  ]);
  assert.deepEqual(await listWithinRequest(contextFor(101, TENANT_B_ID)), [
    `${TENANT_B_ID}:concurrency-visible-to-b`,
  ]);

  assert.equal(requestContext.get(), undefined);
  assert.throws(() => requestContext.require(), /Request context is unavailable/);
});
