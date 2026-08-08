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
import { AcceptInvitationUseCase } from "../src/modules/memberships/application/use-cases/accept-invitation.use-case.js";
import { GetCurrentSessionUseCase } from "../src/modules/sessions/application/use-cases/get-current-session.use-case.js";
import { ResolveTenantUseCase } from "../src/modules/tenancy/application/use-cases/resolve-tenant.use-case.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const TENANT_SLUG = "pending-invite";
const HOSTNAME = `${TENANT_SLUG}.example.test`;
const ORIGIN = `https://${HOSTNAME}`;
const SESSION_TOKEN = createSessionToken();
const ROTATED_SESSION_TOKEN = createSessionToken();
const INVITATION_TOKEN = "invitation-selector.invitation-secret";

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
    .overrideProvider(ResolveTenantUseCase)
    .useValue({ execute: async () => ({ id: TENANT_ID, slug: TENANT_SLUG }) })
    .overrideProvider(GetCurrentSessionUseCase)
    .useValue({
      execute: async () => ({
        actorId: USER_ID,
        sessionId: SESSION_ID,
        authScope: { type: "tenant" as const, tenantId: TENANT_ID },
        sessionState: "invitation_pending" as const,
        authorizationVersion: 1,
        tokenDisposition: "active" as const,
        rotationRequired: false,
      }),
    })
    .overrideProvider(AcceptInvitationUseCase)
    .useValue({
      execute: async (input: unknown) => {
        assert.equal(typeof input, "object");
        assert.notEqual(input, null);
        const command = input as Readonly<Record<string, unknown>>;
        assert.equal(command.tenantId, TENANT_ID);
        assert.equal(command.userId, USER_ID);
        assert.equal(command.sessionId, SESSION_ID);
        assert.equal(command.hostname, HOSTNAME);
        assert.equal(command.token, INVITATION_TOKEN);
        assert.equal(typeof command.requestId, "string");
        assert.notEqual((command.requestId as string).trim(), "");
        return { accepted: true as const, rotatedSessionToken: ROTATED_SESSION_TOKEN };
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
  process.env.PORT = "3127";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL = "postgresql://local-user:local-pass@localhost:5432/booking_os_test";
  process.env.REDIS_URL = "redis://localhost:6379/1";
  process.env.READINESS_TIMEOUT_MS = "100";
  process.env.SESSION_SECRET = "invitation-acceptance-e2e-secret-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = ORIGIN;
  process.env.PAYMENT_PROVIDER = "mock";
});

after(() => {
  for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
    restoreEnvironmentValue(key);
  }
});

test("invitation-pending session obtains CSRF from the session-bound allowlisted route", async () => {
  const app = await createTestApplication();

  try {
    const response = await request(app.getHttpServer())
      .get("/api/auth/session/csrf")
      .set("host", HOSTNAME)
      .set("cookie", `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(SESSION_TOKEN)}`)
      .expect(200);

    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(typeof response.body.csrfToken, "string");
  } finally {
    await app.close();
  }
});

test("invitation-pending session accepts an invitation and receives only the rotated session cookie", async () => {
  const app = await createTestApplication();
  const cookie = `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(SESSION_TOKEN)}`;

  try {
    const csrf = await request(app.getHttpServer())
      .get("/api/auth/session/csrf")
      .set("host", HOSTNAME)
      .set("cookie", cookie)
      .expect(200);

    const response = await request(app.getHttpServer())
      .post("/api/membership/invitations/accept")
      .set("host", HOSTNAME)
      .set("origin", ORIGIN)
      .set("cookie", cookie)
      .set("x-csrf-token", csrf.body.csrfToken)
      .send({ token: INVITATION_TOKEN })
      .expect(200);

    assert.deepEqual(response.body, { accepted: true });
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.match(response.headers["set-cookie"]?.[0] ?? "", /^__Host-booking_session=/u);
    assert.equal(JSON.stringify(response.body).includes(ROTATED_SESSION_TOKEN), false);
  } finally {
    await app.close();
  }
});
