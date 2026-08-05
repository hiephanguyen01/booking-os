import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import type { Prisma } from "@prisma/client";

import type { Environment } from "../config/environment.schema.js";
import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";
import { assertTenantId } from "../modules/tenancy/domain/tenant-id.js";
import { OutboxRepository } from "./outbox.repository.js";

const APPLICATION_DATABASE_ROLE = "booking_app";
const TENANT_A_ID = "99999999-9999-4999-8999-999999999999";
const TENANT_B_ID = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
const PROBE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROLLBACK_EVENT_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const TENANT_B_EVENT_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const TENANT_B_AGGREGATE_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const testEnvironment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  trustProxy: false,
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
let outbox: OutboxRepository;

function runAsApplicationTenant<T>(
  tenantId: string,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${APPLICATION_DATABASE_ROLE}`);
    await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return work(transaction);
  });
}

before(async () => {
  prisma = new PrismaService(new EnvironmentService(testEnvironment));
  outbox = new OutboxRepository();

  await prisma.$connect();
  await prisma.tenant.upsert({
    where: { id: TENANT_A_ID },
    update: { slug: "api-outbox-a", name: "API Outbox A" },
    create: { id: TENANT_A_ID, slug: "api-outbox-a", name: "API Outbox A" },
  });
  await prisma.tenant.upsert({
    where: { id: TENANT_B_ID },
    update: { slug: "api-outbox-b", name: "API Outbox B" },
    create: { id: TENANT_B_ID, slug: "api-outbox-b", name: "API Outbox B" },
  });
  await prisma.outboxEvent.deleteMany({
    where: { id: { in: [ROLLBACK_EVENT_ID, TENANT_B_EVENT_ID] } },
  });
  await prisma.outboxEvent.create({
    data: {
      id: TENANT_B_EVENT_ID,
      tenantId: TENANT_B_ID,
      type: "TenantBEvent",
      aggregateType: "tenant_probe",
      aggregateId: TENANT_B_AGGREGATE_ID,
      payload: { value: "tenant-b" },
    },
  });
});

after(async () => {
  await prisma.outboxEvent.deleteMany({
    where: { id: { in: [ROLLBACK_EVENT_ID, TENANT_B_EVENT_ID] } },
  });
  await prisma.tenantProbe.deleteMany({ where: { id: PROBE_ID } });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A_ID, TENANT_B_ID] } } });
  await prisma.$disconnect();
});

test("rolls back aggregate data and outbox together", async () => {
  await assert.rejects(
    runAsApplicationTenant(TENANT_A_ID, async (transaction) => {
      await transaction.tenantProbe.create({
        data: { id: PROBE_ID, tenantId: TENANT_A_ID, value: "rolled-back" },
      });
      await outbox.append(transaction, {
        id: ROLLBACK_EVENT_ID,
        tenantId: TENANT_A_ID,
        type: "FoundationProbeCreated",
        aggregateType: "tenant_probe",
        aggregateId: PROBE_ID,
        payload: { value: "rolled-back" },
      });
      throw new Error("force rollback");
    }),
  );

  const result = await runAsApplicationTenant(TENANT_A_ID, async (transaction) => ({
    probe: await transaction.tenantProbe.findUnique({ where: { id: PROBE_ID } }),
    event: await transaction.outboxEvent.findUnique({ where: { id: ROLLBACK_EVENT_ID } }),
  }));

  assert.equal(result.probe, null);
  assert.equal(result.event, null);
});

test("application role cannot read or alter another tenant outbox row", async () => {
  const result = await runAsApplicationTenant(TENANT_A_ID, async (transaction) => {
    const visible = await transaction.outboxEvent.findUnique({
      where: { id: TENANT_B_EVENT_ID },
    });
    const updated = await transaction.outboxEvent.updateMany({
      where: { id: TENANT_B_EVENT_ID },
      data: { lastError: "forbidden-update" },
    });
    const rawUpdated = await transaction.$executeRaw`
      UPDATE outbox_events
      SET last_error = ${"forbidden-raw-update"}
      WHERE id = ${TENANT_B_EVENT_ID}::uuid
    `;

    return { visible, updated, rawUpdated };
  });

  assert.equal(result.visible, null);
  assert.equal(result.updated.count, 0);
  assert.equal(result.rawUpdated, 0);

  await assert.rejects(
    runAsApplicationTenant(TENANT_A_ID, (transaction) =>
      transaction.outboxEvent.update({
        where: { id: TENANT_B_EVENT_ID },
        data: { lastError: "forbidden-primary-key-update" },
      }),
    ),
  );

  const persisted = await prisma.outboxEvent.findUniqueOrThrow({
    where: { id: TENANT_B_EVENT_ID },
  });
  assert.equal(persisted.lastError, null);
  assert.equal(persisted.attempts, 0);
});
