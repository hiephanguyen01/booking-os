import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { TENANT_A_ID, TENANT_B_ID } from "@booking-os/testing";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { RequestContextModule } from "../src/common/request-context/request-context.module.js";
import { EnvironmentModule } from "../src/config/environment.module.js";
import { DatabaseModule } from "../src/database/database.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import { TenancyModule } from "../src/modules/tenancy/tenancy.module.js";
import { runTenantTestTransaction } from "./support/tenant-test-transaction.js";

const FOUNDATION_PROBE_AUTHORIZATION = "Bearer foundation-probe";
const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  HOST: process.env.HOST,
  TRUST_PROXY: process.env.TRUST_PROXY,
  PORT: process.env.PORT,
  API_PREFIX: process.env.API_PREFIX,
  APP_VERSION: process.env.APP_VERSION,
  LOG_LEVEL: process.env.LOG_LEVEL,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  READINESS_TIMEOUT_MS: process.env.READINESS_TIMEOUT_MS,
  SESSION_SECRET: process.env.SESSION_SECRET,
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
};

let app: INestApplication;
let prisma: PrismaService;

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[key];
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

async function replaceProbe(tenantId: string, value: string): Promise<void> {
  await runTenantTestTransaction(prisma, tenantId, async (transaction) => {
    await transaction.tenantProbe.deleteMany();
    await transaction.tenantProbe.create({ data: { tenantId, value } });
  });
}

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.PORT = "3101";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??= "postgresql://booking:booking@localhost:5432/booking_os_test";
  process.env.REDIS_URL ??= "redis://localhost:6379/1";
  process.env.READINESS_TIMEOUT_MS = "750";
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  process.env.PAYMENT_PROVIDER = "mock";

  const testingModule = await Test.createTestingModule({
    imports: [EnvironmentModule, RequestContextModule, DatabaseModule, TenancyModule],
  }).compile();
  app = testingModule.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();

  prisma = app.get(PrismaService);
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
  await replaceProbe(TENANT_A_ID, "visible-to-a");
  await replaceProbe(TENANT_B_ID, "visible-to-b");
});

after(async () => {
  await runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.deleteMany(),
  );
  await runTenantTestTransaction(prisma, TENANT_B_ID, (transaction) =>
    transaction.tenantProbe.deleteMany(),
  );
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A_ID, TENANT_B_ID] } } });
  await app.close();
  for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
    restoreEnvironmentValue(key);
  }
});

test("tenant hosts return only their own probes", async () => {
  const tenantA = await request(app.getHttpServer())
    .get("/api/foundation/tenant-probes")
    .set("host", "tenant-a.example.com")
    .set("authorization", FOUNDATION_PROBE_AUTHORIZATION)
    .expect(200);
  const tenantB = await request(app.getHttpServer())
    .get("/api/foundation/tenant-probes")
    .set("host", "tenant-b.example.com")
    .set("authorization", FOUNDATION_PROBE_AUTHORIZATION)
    .expect(200);

  assert.deepEqual(
    tenantA.body.map((probe: { tenantId: string; value: string }) => [probe.tenantId, probe.value]),
    [[TENANT_A_ID, "visible-to-a"]],
  );
  assert.deepEqual(
    tenantB.body.map((probe: { tenantId: string; value: string }) => [probe.tenantId, probe.value]),
    [[TENANT_B_ID, "visible-to-b"]],
  );
});

test("unknown tenant host returns not found", async () => {
  await request(app.getHttpServer())
    .get("/api/foundation/tenant-probes")
    .set("host", "unknown.example.com")
    .set("authorization", FOUNDATION_PROBE_AUTHORIZATION)
    .expect(404);
});

test("invalid probe authorization returns unauthorized", async () => {
  await request(app.getHttpServer())
    .get("/api/foundation/tenant-probes")
    .set("host", "tenant-a.example.com")
    .set("authorization", "Bearer invalid")
    .expect(401);
});
