import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { PrismaClient } from "@prisma/client";

import { WorkerDatabase } from "../database/worker-database.js";
import { PrismaOutboxRepository } from "./prisma-outbox.repository.js";

const TENANT_A_ID = "12121212-1212-4121-8121-121212121212";
const TENANT_B_ID = "13131313-1313-4131-8131-131313131313";
const EVENT_A_ID = "14141414-1414-4141-8141-141414141414";
const EVENT_B_ID = "15151515-1515-4151-8151-151515151515";
const AGGREGATE_A_ID = "16161616-1616-4161-8161-161616161616";
const AGGREGATE_B_ID = "17171717-1717-4171-8171-171717171717";

const databaseUrl =
  process.env.DATABASE_URL ?? "postgresql://booking:booking@localhost:5432/booking_os_test";

let prisma: PrismaClient;
let repository: PrismaOutboxRepository;

before(async () => {
  prisma = new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });
  repository = new PrismaOutboxRepository(new WorkerDatabase(prisma));

  await prisma.$connect();
  await prisma.tenant.upsert({
    where: { id: TENANT_A_ID },
    update: { slug: "worker-outbox-a", name: "Worker Outbox A" },
    create: { id: TENANT_A_ID, slug: "worker-outbox-a", name: "Worker Outbox A" },
  });
  await prisma.tenant.upsert({
    where: { id: TENANT_B_ID },
    update: { slug: "worker-outbox-b", name: "Worker Outbox B" },
    create: { id: TENANT_B_ID, slug: "worker-outbox-b", name: "Worker Outbox B" },
  });
  await prisma.outboxEvent.deleteMany({
    where: { id: { in: [EVENT_A_ID, EVENT_B_ID] } },
  });
  await prisma.outboxEvent.create({
    data: {
      id: EVENT_A_ID,
      tenantId: TENANT_A_ID,
      type: "WorkerTenantAEvent",
      aggregateType: "tenant_probe",
      aggregateId: AGGREGATE_A_ID,
      payload: { value: "worker-a" },
      occurredAt: new Date("2000-01-01T00:00:00.000Z"),
      availableAt: new Date("2000-01-01T00:00:00.000Z"),
    },
  });
  await prisma.outboxEvent.create({
    data: {
      id: EVENT_B_ID,
      tenantId: TENANT_B_ID,
      type: "WorkerTenantBEvent",
      aggregateType: "tenant_probe",
      aggregateId: AGGREGATE_B_ID,
      payload: { value: "worker-b" },
      occurredAt: new Date("2000-01-01T00:00:01.000Z"),
      availableAt: new Date("2000-01-01T00:00:00.000Z"),
    },
  });
});

after(async () => {
  await prisma.outboxEvent.deleteMany({
    where: { id: { in: [EVENT_A_ID, EVENT_B_ID] } },
  });
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A_ID, TENANT_B_ID] } } });
  await prisma.$disconnect();
});

test("worker role claims and transitions outbox events across tenants", async () => {
  const claimed = await repository.claimBatch(2);

  assert.deepEqual(
    claimed
      .map((event) => [event.id, event.tenantId, event.attempts] as const)
      .sort(([left], [right]) => left.localeCompare(right)),
    [
      [EVENT_A_ID, TENANT_A_ID, 1],
      [EVENT_B_ID, TENANT_B_ID, 1],
    ],
  );

  await repository.markDispatched(EVENT_A_ID);
  assert.equal(await repository.markFailed(EVENT_B_ID, "Error", 1), "dead-lettered");

  const [eventA, eventB] = await Promise.all([
    prisma.outboxEvent.findUniqueOrThrow({ where: { id: EVENT_A_ID } }),
    prisma.outboxEvent.findUniqueOrThrow({ where: { id: EVENT_B_ID } }),
  ]);

  assert.notEqual(eventA.dispatchedAt, null);
  assert.equal(eventA.claimedAt, null);
  assert.equal(eventA.lastError, null);

  assert.notEqual(eventB.deadLetteredAt, null);
  assert.equal(eventB.claimedAt, null);
  assert.equal(eventB.lastError, "Error");
});
