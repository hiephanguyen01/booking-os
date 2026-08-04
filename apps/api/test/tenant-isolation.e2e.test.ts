import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { TENANT_A_ID, TENANT_B_ID } from "@booking-os/testing";

import type { Environment } from "../src/config/environment.schema.js";
import { EnvironmentService } from "../src/config/environment.service.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { TenantContextService } from "../src/tenancy/tenant-context.service.js";

const testEnvironment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  port: 3101,
  apiPrefix: "api",
  appVersion: "0.1.0-e2e",
  logLevel: "error",
  databaseUrl:
    process.env.DATABASE_URL ?? "postgresql://booking:booking@localhost:5432/booking_os_test",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379/1",
  sessionSecret: "test-only-session-secret-at-least-32-characters",
  paymentProvider: "mock",
};

let prisma: PrismaService;
let tenantContext: TenantContextService;
let tenantBProbeId: string;

async function replaceTenantProbe(tenantId: string, value: string): Promise<string> {
  return tenantContext.runInTenant(tenantId, async (transaction) => {
    await transaction.tenantProbe.deleteMany();
    const probe = await transaction.tenantProbe.create({
      data: { tenantId, value },
    });

    return probe.id;
  });
}

before(async () => {
  prisma = new PrismaService(new EnvironmentService(testEnvironment));
  tenantContext = new TenantContextService(prisma);

  await prisma.$connect();
  await prisma.tenant.upsert({
    where: { id: TENANT_A_ID },
    update: { slug: "tenant-a", name: "Tenant A" },
    create: { id: TENANT_A_ID, slug: "tenant-a", name: "Tenant A" },
  });
  await prisma.tenant.upsert({
    where: { id: TENANT_B_ID },
    update: { slug: "tenant-b", name: "Tenant B" },
    create: { id: TENANT_B_ID, slug: "tenant-b", name: "Tenant B" },
  });

  await replaceTenantProbe(TENANT_A_ID, "visible-to-a");
  tenantBProbeId = await replaceTenantProbe(TENANT_B_ID, "visible-to-b");
});

after(async () => {
  await tenantContext.runInTenant(TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.deleteMany(),
  );
  await tenantContext.runInTenant(TENANT_B_ID, (transaction) =>
    transaction.tenantProbe.deleteMany(),
  );
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A_ID, TENANT_B_ID] } } });
  await prisma.$disconnect();
});

test("tenant A cannot read tenant B rows", async () => {
  const rowsForA = await tenantContext.runInTenant(TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.findMany({ orderBy: { id: "asc" } }),
  );

  assert.deepEqual(
    rowsForA.map((row) => row.tenantId),
    [TENANT_A_ID],
  );
  assert.deepEqual(
    rowsForA.map((row) => row.value),
    ["visible-to-a"],
  );
});

test("tenant A cannot insert a row owned by tenant B", async () => {
  await assert.rejects(
    tenantContext.runInTenant(TENANT_A_ID, (transaction) =>
      transaction.tenantProbe.create({
        data: { tenantId: TENANT_B_ID, value: "forbidden" },
      }),
    ),
  );
});

test("tenant A cannot fetch tenant B data by raw primary key", async () => {
  const row = await tenantContext.runInTenant(TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.findUnique({ where: { id: tenantBProbeId } }),
  );

  assert.equal(row, null);
});
