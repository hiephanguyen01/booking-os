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
import { ResolveTenantUseCase } from "../src/modules/tenancy/application/use-cases/resolve-tenant.use-case.js";

const PLATFORM_HOSTNAME = "platform.example.test";
const UNRESOLVED_HOSTNAME = "unresolved.example.test";
const CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";

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

async function createTestApplication(): Promise<INestApplication> {
  const testingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(POSTGRES_READINESS_PROBE_TOKEN)
    .useValue({ dependency: "postgresql", check: async () => ({ status: "ok", latencyMs: 1 }) })
    .overrideProvider(REDIS_READINESS_PROBE_TOKEN)
    .useValue({ dependency: "redis", check: async () => ({ status: "ok", latencyMs: 1 }) })
    .overrideProvider(ResolveTenantUseCase)
    .useValue({ execute: async () => null })
    .compile();

  const app = testingModule.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}

function assertCommonSecurityHeaders(headers: Record<string, string | string[] | undefined>): void {
  assert.equal(headers["content-security-policy"], CONTENT_SECURITY_POLICY);
  assert.equal(headers["x-frame-options"], "DENY");
  assert.equal(headers["x-content-type-options"], "nosniff");
  assert.equal(headers["referrer-policy"], "no-referrer");
  assert.equal(headers["permissions-policy"], "camera=(), geolocation=(), microphone=()");
}

before(() => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = PLATFORM_HOSTNAME;
  process.env.PORT = "3106";
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

test("Task 5 hardens activation, reset, invite, login, me, and authorization responses", async () => {
  const app = await createTestApplication();

  try {
    const cases = [
      {
        name: "activation csrf",
        execute: () =>
          request(app.getHttpServer())
            .get("/api/auth/csrf?purpose=activation")
            .set("host", PLATFORM_HOSTNAME)
            .expect(200),
        cacheControl: "no-store",
      },
      {
        name: "activation completion error",
        execute: () =>
          request(app.getHttpServer())
            .post("/api/auth/activation/complete")
            .set("host", UNRESOLVED_HOSTNAME)
            .send({})
            .expect(400),
        cacheControl: "no-store",
      },
      {
        name: "password reset error",
        execute: () =>
          request(app.getHttpServer())
            .post("/api/auth/password/reset")
            .set("host", UNRESOLVED_HOSTNAME)
            .send({})
            .expect(400),
        cacheControl: "no-store",
      },
      {
        name: "login validation error",
        execute: () =>
          request(app.getHttpServer())
            .post("/api/auth/login")
            .set("host", PLATFORM_HOSTNAME)
            .send({})
            .expect(400),
        cacheControl: "no-store",
      },
      {
        name: "unauthenticated me",
        execute: () =>
          request(app.getHttpServer())
            .get("/api/auth/me")
            .set("host", PLATFORM_HOSTNAME)
            .expect(401),
        cacheControl: "no-store",
      },
      {
        name: "unauthenticated authorization",
        execute: () =>
          request(app.getHttpServer())
            .get("/api/auth/me/authorization")
            .set("host", PLATFORM_HOSTNAME)
            .expect(401),
        cacheControl: "private, no-store",
      },
      {
        name: "unauthenticated invitation",
        execute: () =>
          request(app.getHttpServer())
            .get("/api/membership/invitations/current")
            .set("host", PLATFORM_HOSTNAME)
            .expect(401),
        cacheControl: "no-store",
      },
    ] as const;

    for (const testCase of cases) {
      const response = await testCase.execute();
      assertCommonSecurityHeaders(response.headers);
      assert.equal(
        response.headers["cache-control"],
        testCase.cacheControl,
        `${testCase.name} cache-control`,
      );
    }
  } finally {
    await app.close();
  }
});
