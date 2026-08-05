import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/database/prisma.service.js";
import {
  POSTGRES_READINESS_PROBE_TOKEN,
  REDIS_READINESS_PROBE_TOKEN,
} from "../src/dependencies/tokens.js";
import { runTenantTestTransaction } from "./support/tenant-test-transaction.js";

const TENANT_A_ID = "77777777-7777-4777-8777-777777777777";
const TENANT_B_ID = "88888888-8888-4888-8888-888888888888";
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

interface ProbeResponse {
  readonly tenantId: string;
  readonly value: string;
}

let directHostApp: INestApplication;
let trustedProxyApp: INestApplication;
let prisma: PrismaService;

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const value = originalEnvironment[key];
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function configureEnvironment(trustProxy: boolean): void {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = String(trustProxy);
  process.env.PORT = "3101";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL ??=
    "postgresql://booking:booking@localhost:5432/booking_os_test";
  process.env.REDIS_URL ??= "redis://localhost:6379/1";
  process.env.READINESS_TIMEOUT_MS = "100";
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  process.env.PAYMENT_PROVIDER = "mock";
}

async function createApplication(trustProxy: boolean): Promise<INestApplication> {
  configureEnvironment(trustProxy);

  const testingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(POSTGRES_READINESS_PROBE_TOKEN)
    .useValue({
      dependency: "postgresql",
      check: async () => ({ status: "ok", latencyMs: 1 }),
    })
    .overrideProvider(REDIS_READINESS_PROBE_TOKEN)
    .useValue({
      dependency: "redis",
      check: async () => ({ status: "ok", latencyMs: 1 }),
    })
    .compile();

  const app = testingModule.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}

async function replaceProbe(tenantId: string, value: string): Promise<void> {
  await runTenantTestTransaction(prisma, tenantId, async (transaction) => {
    await transaction.tenantProbe.deleteMany();
    await transaction.tenantProbe.create({ data: { tenantId, value } });
  });
}

function probeRequest(app: INestApplication, host: string) {
  return request(app.getHttpServer())
    .get("/api/foundation/tenant-probes")
    .set("host", host)
    .set("authorization", FOUNDATION_PROBE_AUTHORIZATION);
}

function probePairs(body: readonly ProbeResponse[]): readonly (readonly [string, string])[] {
  return body.map((probe) => [probe.tenantId, probe.value] as const);
}

before(async () => {
  directHostApp = await createApplication(false);
  trustedProxyApp = await createApplication(true);
  prisma = directHostApp.get(PrismaService);

  await prisma.tenant.upsert({
    where: { id: TENANT_A_ID },
    update: { slug: "resolution-a", name: "Resolution A" },
    create: { id: TENANT_A_ID, slug: "resolution-a", name: "Resolution A" },
  });
  await prisma.tenant.upsert({
    where: { id: TENANT_B_ID },
    update: { slug: "resolution-b", name: "Resolution B" },
    create: { id: TENANT_B_ID, slug: "resolution-b", name: "Resolution B" },
  });
  await replaceProbe(TENANT_A_ID, "resolution-visible-to-a");
  await replaceProbe(TENANT_B_ID, "resolution-visible-to-b");
});

after(async () => {
  await runTenantTestTransaction(prisma, TENANT_A_ID, (transaction) =>
    transaction.tenantProbe.deleteMany(),
  );
  await runTenantTestTransaction(prisma, TENANT_B_ID, (transaction) =>
    transaction.tenantProbe.deleteMany(),
  );
  await prisma.tenant.deleteMany({ where: { id: { in: [TENANT_A_ID, TENANT_B_ID] } } });
  await directHostApp.close();
  await trustedProxyApp.close();

  for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
    restoreEnvironmentValue(key);
  }
});

test("tenant A and B hosts resolve to isolated tenant data", async () => {
  const tenantA = await probeRequest(directHostApp, "resolution-a.example.com").expect(200);
  const tenantB = await probeRequest(directHostApp, "resolution-b.example.com").expect(200);

  assert.deepEqual(probePairs(tenantA.body as ProbeResponse[]), [
    [TENANT_A_ID, "resolution-visible-to-a"],
  ]);
  assert.deepEqual(probePairs(tenantB.body as ProbeResponse[]), [
    [TENANT_B_ID, "resolution-visible-to-b"],
  ]);
});

test("body query and client headers cannot override the resolved tenant", async () => {
  const response = await probeRequest(directHostApp, "resolution-a.example.com")
    .query({ tenantId: TENANT_B_ID })
    .set("x-tenant-id", TENANT_B_ID)
    .set("x-actor-id", "malicious-actor")
    .set("x-source", "worker")
    .send({ tenantId: TENANT_B_ID })
    .expect(200);

  assert.deepEqual(probePairs(response.body as ProbeResponse[]), [
    [TENANT_A_ID, "resolution-visible-to-a"],
  ]);
});

test("unknown and non-tenant hosts fail closed", async () => {
  await probeRequest(directHostApp, "unknown.example.com").expect(404);
  await probeRequest(directHostApp, "localhost").expect(404);
});

test("disabled proxy trust ignores x-forwarded-host", async () => {
  const response = await probeRequest(directHostApp, "resolution-a.example.com")
    .set("x-forwarded-host", "resolution-b.example.com")
    .expect(200);

  assert.deepEqual(probePairs(response.body as ProbeResponse[]), [
    [TENANT_A_ID, "resolution-visible-to-a"],
  ]);
});

test("enabled proxy trust uses only the first forwarded host", async () => {
  const response = await probeRequest(trustedProxyApp, "api.internal")
    .set("x-forwarded-host", "resolution-b.example.com, proxy.internal")
    .expect(200);

  assert.deepEqual(probePairs(response.body as ProbeResponse[]), [
    [TENANT_B_ID, "resolution-visible-to-b"],
  ]);
});

test("health and readiness remain global for unknown tenant hosts", async () => {
  await request(directHostApp.getHttpServer())
    .get("/api/health")
    .set("host", "unknown.example.com")
    .expect(200);
  await request(directHostApp.getHttpServer())
    .get("/api/ready")
    .set("host", "unknown.example.com")
    .expect(200);
});
