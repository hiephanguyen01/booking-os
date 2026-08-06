import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { BOOKING_SESSION_COOKIE, createSessionToken } from "@booking-os/auth";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";
import {
  POSTGRES_READINESS_PROBE_TOKEN,
  REDIS_READINESS_PROBE_TOKEN,
} from "../src/dependencies/tokens.js";
import { GetCurrentSessionUseCase } from "../src/modules/sessions/application/use-cases/get-current-session.use-case.js";
import { LoginUseCase } from "../src/modules/sessions/application/use-cases/login.use-case.js";

const ORIGIN = "https://console.example.test";
const HOSTNAME = "console.example.test";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_TOKEN = createSessionToken();

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  HOST: process.env.HOST,
  TRUST_PROXY: process.env.TRUST_PROXY,
  TENANT_BASE_DOMAIN: process.env.TENANT_BASE_DOMAIN,
  PORT: process.env.PORT,
  API_PREFIX: process.env.API_PREFIX,
  APP_VERSION: process.env.APP_VERSION,
  LOG_LEVEL: process.env.LOG_LEVEL,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
  READINESS_TIMEOUT_MS: process.env.READINESS_TIMEOUT_MS,
  SESSION_SECRET: process.env.SESSION_SECRET,
  SESSION_ALLOWED_ORIGINS: process.env.SESSION_ALLOWED_ORIGINS,
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
    .overrideProvider(GetCurrentSessionUseCase)
    .useValue({
      execute: async () => ({
        actorId: USER_ID,
        sessionId: SESSION_ID,
        authScope: { type: "platform" as const },
        sessionState: "active" as const,
        authorizationVersion: 3,
        tokenDisposition: "active" as const,
        rotationRequired: false,
      }),
    })
    .overrideProvider(LoginUseCase)
    .useValue({
      execute: async () => ({
        token: SESSION_TOKEN,
        session: {
          id: SESSION_ID,
          state: "active" as const,
          scope: { type: "platform" as const },
        },
      }),
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
  process.env.PORT = "3102";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL = "postgresql://local-user:local-pass@localhost:5432/booking_os_test";
  process.env.REDIS_URL = "redis://localhost:6379/1";
  process.env.READINESS_TIMEOUT_MS = "100";
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = ORIGIN;
  process.env.PAYMENT_PROVIDER = "mock";
});

after(() => {
  for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
    restoreEnvironmentValue(key);
  }
});

test("session CSRF is issued, enforced on login, and session middleware hydrates /auth/me", async () => {
  const app = await createTestApplication();

  try {
    const csrf = await request(app.getHttpServer())
      .get("/api/auth/session/csrf")
      .set("host", HOSTNAME)
      .expect(200);

    assert.equal(csrf.headers["cache-control"], "private, no-store");
    assert.equal(typeof csrf.body.csrfToken, "string");

    await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("host", HOSTNAME)
      .send({ email: "owner@example.test", password: "correct horse battery staple" })
      .expect(403);

    const login = await request(app.getHttpServer())
      .post("/api/auth/login")
      .set("host", HOSTNAME)
      .set("origin", ORIGIN)
      .set("x-csrf-token", csrf.body.csrfToken)
      .send({ email: "owner@example.test", password: "correct horse battery staple" })
      .expect(200);

    assert.deepEqual(login.body, {
      session: {
        id: SESSION_ID,
        state: "active",
        scope: { type: "platform" },
      },
    });
    assert.match(login.headers["set-cookie"]?.[0] ?? "", /^__Host-booking_session=/u);

    const me = await request(app.getHttpServer())
      .get("/api/auth/me")
      .set("host", HOSTNAME)
      .set("cookie", `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(SESSION_TOKEN)}`)
      .expect(200);

    assert.deepEqual(me.body, {
      actor: { id: USER_ID },
      session: {
        id: SESSION_ID,
        state: "active",
        scope: { type: "platform" },
      },
    });
    assert.equal(me.headers["cache-control"], "private, no-store");
  } finally {
    await app.close();
  }
});
