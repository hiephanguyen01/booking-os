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

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  HOST: process.env.HOST,
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
    .compile();

  const app = testingModule.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  return app;
}

before(() => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
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
      .set("host", "console.example.test")
      .expect(200);

    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    assert.match(response.headers["set-cookie"]?.[0] ?? "", /^__Host-booking_pre_auth_csrf=/u);
    assert.equal(typeof response.body.csrfToken, "string");
    assert.match(response.body.expiresAt, /^202[0-9]-/u);
  } finally {
    await app.close();
  }
});
