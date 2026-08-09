import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";
import {
  POSTGRES_READINESS_PROBE_TOKEN,
  REDIS_READINESS_PROBE_TOKEN,
} from "../src/dependencies/tokens.js";
import type { CompleteActivationCommand } from "../src/modules/identity/application/use-cases/complete-activation.js";
import { CompleteActivationUseCase } from "../src/modules/identity/application/use-cases/complete-activation.js";
import { ResolveTenantUseCase } from "../src/modules/tenancy/application/use-cases/resolve-tenant.use-case.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_SLUG = "studio";
const TENANT_HOSTNAME = `${TENANT_SLUG}.example.test`;
const PLATFORM_HOSTNAME = "platform.example.test";

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  HOST: process.env.HOST,
  TRUST_PROXY: process.env.TRUST_PROXY,
  TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
  PLATFORM_HOSTNAME: process.env.PLATFORM_HOSTNAME,
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

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const originalValue = originalEnvironment[key];
  if (originalValue === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = originalValue;
}

async function createTestApplication(
  activationCommands: CompleteActivationCommand[] = [],
): Promise<INestApplication> {
  const testingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(POSTGRES_READINESS_PROBE_TOKEN)
    .useValue({ dependency: "postgresql", check: async () => ({ status: "ok", latencyMs: 1 }) })
    .overrideProvider(REDIS_READINESS_PROBE_TOKEN)
    .useValue({ dependency: "redis", check: async () => ({ status: "ok", latencyMs: 1 }) })
    .overrideProvider(ResolveTenantUseCase)
    .useValue({
      execute: async (hostname: string) =>
        hostname === TENANT_HOSTNAME ? { id: TENANT_ID, slug: TENANT_SLUG } : null,
    })
    .overrideProvider(CompleteActivationUseCase)
    .useValue({
      execute: async (command: CompleteActivationCommand) => {
        activationCommands.push(command);
        return { userId: "22222222-2222-4222-8222-222222222222" };
      },
    })
    .compile();

  const app = testingModule.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}

before(() => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = PLATFORM_HOSTNAME;
  process.env.PORT = "3101";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL = "postgresql://local-user:local-pass@localhost:5432/booking_os_test";
  process.env.REDIS_URL = "redis://localhost:6379/1";
  process.env.READINESS_TIMEOUT_MS = "100";
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  process.env.PAYMENT_PROVIDER = "mock";
});

after(() => {
  for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
    restoreEnvironmentValue(key);
  }
});

test("GET /api/auth/csrf is registered by AppModule and returns a host-only pre-auth proof", async () => {
  const app = await createTestApplication();

  try {
    const response = await request(app.getHttpServer())
      .get("/api/auth/csrf?purpose=activation")
      .set("host", PLATFORM_HOSTNAME)
      .expect(200);

    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    const cookie = response.headers["set-cookie"]?.[0] ?? "";
    assert.match(cookie, /^__Host-booking_pre_auth_csrf=/u);
    assert.match(cookie, /; Max-Age=900;/u);
    assert.match(cookie, /; Path=\//u);
    assert.match(cookie, /; HttpOnly/u);
    assert.match(cookie, /; Secure/u);
    assert.match(cookie, /; SameSite=Strict/u);
    assert.equal(typeof response.body.csrfToken, "string");
    assert.match(response.body.expiresAt, /^202[0-9]-/u);
  } finally {
    await app.close();
  }
});

test("tenant public identity commands receive middleware-resolved scope without a session", async () => {
  const activationCommands: CompleteActivationCommand[] = [];
  const app = await createTestApplication(activationCommands);

  try {
    const csrf = await request(app.getHttpServer())
      .get("/api/auth/csrf?purpose=activation")
      .set("host", TENANT_HOSTNAME)
      .expect(200);
    const csrfCookie = csrf.headers["set-cookie"]?.[0]?.split(";", 1)[0];
    assert.equal(typeof csrfCookie, "string");

    await request(app.getHttpServer())
      .post("/api/auth/activation/complete")
      .set("host", TENANT_HOSTNAME)
      .set("origin", `http://${TENANT_HOSTNAME}`)
      .set("cookie", csrfCookie ?? "")
      .set("x-csrf-token", csrf.body.csrfToken)
      .send({
        token: "selector.secret",
        newPassword: "correct horse battery staple",
        scopeType: "platform",
      })
      .expect(200);

    assert.equal(activationCommands.length, 1);
    const activationCommand = activationCommands[0];
    assert.ok(activationCommand);
    const { requestId, ...command } = activationCommand;
    assert.equal(typeof requestId, "string");
    assert.deepEqual(command, {
      token: "selector.secret",
      newPassword: "correct horse battery staple",
      hostname: TENANT_HOSTNAME,
      scopeType: "tenant",
      tenantId: TENANT_ID,
    });
  } finally {
    await app.close();
  }
});
