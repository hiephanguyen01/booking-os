import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { TENANT_A_ID } from "@booking-os/testing";

import type { Environment } from "../config/environment.schema.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { TenantContextService } from "../tenancy/tenant-context.service.js";
import { OutboxRepository } from "./outbox.repository.js";

const PROBE_ID = "33333333-3333-4333-8333-333333333333";
const EVENT_ID = "44444444-4444-4444-8444-444444444444";

const testEnvironment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  port: 3101,
  apiPrefix: "api",
  appVersion: "0.1.0-test",
  logLevel: "error",
  databaseUrl:
    process.env.DATABASE_URL ?? "postgresql://booking:booking@localhost:5432/booking_os_test",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379/1",
  readinessTimeoutMs: 750,
  sessionSecret: "test-only-session-secret-at-least-32-characters",
  paymentProvider: "mock",
};

let prisma: PrismaService;
let tenantContext: TenantContextService;
let outbox: OutboxRepository;

before(async () => {
  prisma = new PrismaService(new EnvironmentService(testEnvironment));
  tenantContext = new TenantContextService(prisma);
  outbox = new OutboxRepository();

  await prisma.$connect();
  await prisma.tenant.upsert({
    where: { id: TENANT_A_ID },
    update: { slug: "tenant-a", name: "Tenant A" },
    create: { id: TENANT_A_ID, slug: "tenant-a", name: "Tenant A" },
  });
});

after(async () => {
  await tenantContext.runInTenant(TENANT_A_ID, async (transaction) => {
    await transaction.outboxEvent.deleteMany();
    await transaction.tenantProbe.deleteMany();
  });
  await prisma.tenant.deleteMany({ where: { id: TENANT_A_ID } });
  await prisma.$disconnect();
});

test("rolls back aggregate data and outbox together", async () => {
  await assert.rejects(
    tenantContext.runInTenant(TENANT_A_ID, async (transaction) => {
      await transaction.tenantProbe.create({
        data: { id: PROBE_ID, tenantId: TENANT_A_ID, value: "rolled-back" },
      });
      await outbox.append(transaction, {
        id: EVENT_ID,
        tenantId: TENANT_A_ID,
        type: "FoundationProbeCreated",
        aggregateType: "tenant_probe",
        aggregateId: PROBE_ID,
        payload: { value: "rolled-back" },
      });
      throw new Error("force rollback");
    }),
  );

  const result = await tenantContext.runInTenant(TENANT_A_ID, async (transaction) => ({
    probe: await transaction.tenantProbe.findUnique({ where: { id: PROBE_ID } }),
    event: await transaction.outboxEvent.findUnique({ where: { id: EVENT_ID } }),
  }));

  assert.equal(result.probe, null);
  assert.equal(result.event, null);
});
