import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import type { Prisma } from "@prisma/client";

import type { Environment } from "../src/config/environment.schema.js";
import { EnvironmentService } from "../src/config/environment.service.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { runTenantTestTransaction } from "./support/tenant-test-transaction.js";

const testEnvironment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  trustProxy: false,
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

const TENANT_A_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_B_ID = "44444444-4444-4444-8444-444444444444";

const COMMITTED_VALUE = "committed-by-a";
const ROLLED_BACK_VALUE = "rolled-back-by-a";
const SENTINEL = new Error("rollback-sentinel");

let prisma: PrismaService;
let tenantAProbeId: string;
let tenantBProbeId: string;

async function replaceTenantProbe(tenantId: string, value: string): Promise<string> {
  return runTenantTestTransaction(prisma, tenantId, async (transaction) => {
    await transaction.tenantProbe.deleteMany();
    const probe = await transaction.tenantProbe.create({
      data: { tenantId, value },
    });

    return probe.id;
  });
}

async function findByValue(
  tenantId: string,
  value: string,
): Promise<{ readonly id: string; readonly tenantId: string; readonly value: string } | null> {
  return runTenantTestTransaction(prisma, tenantId, (transaction) =>
    transaction.tenantProbe.findFirst({
      where: { value },
      select: { id: true, tenantId: true, value: true },
    }),
  );
}

before(async () => {
  prisma = new PrismaService(new EnvironmentService(testEnvironment));

  await prisma.$connect();
  await prisma.tenant.upsert({
    where: { id: TENANT_A_ID },
    update: { slug: "isolation-a", name: "Isolation A" },
    create: { id: TENANT_A_ID, slug: "isolation-a", name: "Isolation A" },
  });
  await prisma.tenant.upsert({
    where: { id: TENANT_B_ID },
    update: { slug: "isolation-b", name: "Isolation B" },
    create: { id: TENANT_B_ID, slug: "isolation-b", name: "Isolation B" },
  });

  tenantAProbeId = await replaceTenantProbe(TENANT_A_ID, "visible-to-a");
  tenantBProbeId = await replaceTenantProbe(TENANT_B_ID, "visible-to-b");
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

test("tenant A list contains only tenant A rows", async () => {
  const rows = await runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.findMany({
      orderBy: { id: "asc" },
      select: { id: true, tenantId: true, value: true },
    }),
  );

  assert.deepEqual(
    rows.map((row) => [row.tenantId, row.value]),
    [[TENANT_A_ID, "visible-to-a"]],
  );
});

test("tenant A cannot find tenant B by primary key", async () => {
  const row = await runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.findUnique({ where: { id: tenantBProbeId } }),
  );

  assert.equal(row, null);
});

test("tenant A raw select cannot see tenant B", async () => {
  const rows = await runTenantTestTransaction(
    prisma,
    TENANT_A_ID,
    (transaction) =>
      transaction.$queryRaw<readonly { id: string; tenant_id: string }[]>`
      SELECT id, tenant_id
      FROM tenant_probes
      WHERE id = ${tenantBProbeId}
    `,
  );

  assert.deepEqual(rows, []);
});

test("tenant A cannot insert a tenant B row", async () => {
  await assert.rejects(
    runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
      transaction.tenantProbe.create({
        data: { tenantId: TENANT_B_ID, value: "forbidden-insert" },
      }),
    ),
  );
});

test("tenant A cannot update tenant B by primary key", async () => {
  await assert.rejects(
    runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
      transaction.tenantProbe.update({
        where: { id: tenantBProbeId },
        data: { value: "forbidden-update" },
      }),
    ),
  );
});

test("tenant A updateMany cannot modify tenant B", async () => {
  const result = await runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.updateMany({
      where: { id: tenantBProbeId },
      data: { value: "forbidden-update-many" },
    }),
  );

  assert.equal(result.count, 0);
  assert.equal((await findByValue(TENANT_B_ID, "visible-to-b"))?.id, tenantBProbeId);
});

test("tenant A cannot delete tenant B by primary key", async () => {
  await assert.rejects(
    runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
      transaction.tenantProbe.delete({ where: { id: tenantBProbeId } }),
    ),
  );
});

test("tenant A deleteMany cannot remove tenant B", async () => {
  const result = await runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.deleteMany({ where: { id: tenantBProbeId } }),
  );

  assert.equal(result.count, 0);
  assert.equal((await findByValue(TENANT_B_ID, "visible-to-b"))?.id, tenantBProbeId);
});

test("tenant A cannot upsert tenant B by primary key", async () => {
  await assert.rejects(
    runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
      transaction.tenantProbe.upsert({
        where: { id: tenantBProbeId },
        update: { value: "forbidden-upsert-update" },
        create: {
          id: tenantBProbeId,
          tenantId: TENANT_B_ID,
          value: "forbidden-upsert-create",
        },
      }),
    ),
  );
});

test("tenant A raw update cannot modify tenant B", async () => {
  const count = await runTenantTestTransaction(
    prisma,
    TENANT_A_ID,
    (transaction) =>
      transaction.$executeRaw`
      UPDATE tenant_probes
      SET value = ${"forbidden-raw-update"}
      WHERE id = ${tenantBProbeId}
    `,
  );

  assert.equal(count, 0);
  assert.equal((await findByValue(TENANT_B_ID, "visible-to-b"))?.id, tenantBProbeId);
});

test("successful tenant transaction commits", async () => {
  const committedId = await runTenantTestTransaction(prisma, TENANT_A_ID, async (transaction) => {
    const row = await transaction.tenantProbe.create({
      data: { tenantId: TENANT_A_ID, value: COMMITTED_VALUE },
    });
    return row.id;
  });

  assert.equal((await findByValue(TENANT_A_ID, COMMITTED_VALUE))?.id, committedId);

  await runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.delete({ where: { id: committedId } }),
  );
});

test("failed tenant transaction rolls back", async () => {
  await assert.rejects(
    runTenantTestTransaction(prisma, TENANT_A_ID, async (transaction) => {
      await transaction.tenantProbe.create({
        data: { tenantId: TENANT_A_ID, value: ROLLED_BACK_VALUE },
      });
      throw SENTINEL;
    }),
    (error) => error === SENTINEL,
  );

  assert.equal(await findByValue(TENANT_A_ID, ROLLED_BACK_VALUE), null);
});

test("malformed tenant ID rejects before opening a Prisma transaction", async () => {
  let transactionCalls = 0;
  const fakePrisma = {
    $transaction: async (
      _work: (transaction: Prisma.TransactionClient) => Promise<unknown>,
    ): Promise<unknown> => {
      transactionCalls += 1;
      return undefined;
    },
  } as unknown as PrismaService;

  await assert.rejects(
    runTenantTestTransaction(fakePrisma, "not-a-tenant-id", async () => undefined),
    TypeError,
  );
  assert.equal(transactionCalls, 0);
});

test("tenant A still owns its original row after the isolation matrix", async () => {
  const row = await runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.findUnique({ where: { id: tenantAProbeId } }),
  );

  assert.equal(row?.tenantId, TENANT_A_ID);
  assert.equal(row?.value, "visible-to-a");
});
