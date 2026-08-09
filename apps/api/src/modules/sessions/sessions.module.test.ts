import assert from "node:assert/strict";
import test from "node:test";

import { Test } from "@nestjs/testing";

import { AppModule } from "../../app.module.js";
import { PrismaService } from "../../database/prisma.service.js";
import {
  POSTGRES_READINESS_PROBE_TOKEN,
  REDIS_CLIENT_TOKEN,
  REDIS_READINESS_PROBE_TOKEN,
} from "../../dependencies/tokens.js";
import { ResolvePendingInvitationLoginUseCase } from "../memberships/application/use-cases/resolve-pending-invitation-login.use-case.js";
import { CreateSessionUseCase } from "./application/use-cases/create-session.js";
import { LoginUseCase } from "./application/use-cases/login.use-case.js";
import { CREDENTIAL_VERIFIER_PORT, LOGIN_ABUSE_PROTECTION_PORT } from "./sessions.tokens.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const HOSTNAME = "acme.example.test";

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
  SESSION_ALLOWED_ORIGINS: process.env.SESSION_ALLOWED_ORIGINS,
  PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
  IDENTITY_TOKEN_PEPPER: process.env.IDENTITY_TOKEN_PEPPER,
  IDENTITY_ENVELOPE_KEYS: process.env.IDENTITY_ENVELOPE_KEYS,
  IDENTITY_ACTIVE_ENVELOPE_KEY_ID: process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID,
};

function restoreEnvironment(): void {
  for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
    const value = originalEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function configureEnvironment(): void {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = "platform.example.test";
  process.env.PORT = "3128";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-test";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL = "postgresql://local-user:local-pass@localhost:5432/booking_os_test";
  process.env.REDIS_URL = "redis://localhost:6379/14";
  process.env.READINESS_TIMEOUT_MS = "100";
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  process.env.SESSION_ALLOWED_ORIGINS = `https://${HOSTNAME}`;
  process.env.PAYMENT_PROVIDER = "mock";
  process.env.IDENTITY_TOKEN_PEPPER = Buffer.alloc(32, 1).toString("base64");
  process.env.IDENTITY_ENVELOPE_KEYS = JSON.stringify({
    "identity-v1": Buffer.alloc(32, 2).toString("base64"),
  });
  process.env.IDENTITY_ACTIVE_ENVELOPE_KEY_ID = "identity-v1";
}

test("SessionsModule composes pending invitation eligibility into the real login subject provider", async () => {
  configureEnvironment();
  const issued: unknown[] = [];

  try {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue({
        user: {
          findUnique: async () => ({ status: "active", authorizationVersion: 7 }),
        },
        roleAssignment: {
          findFirst: async () => null,
        },
      })
      .overrideProvider(CREDENTIAL_VERIFIER_PORT)
      .useValue({
        verify: async () => ({
          userId: USER_ID,
          status: "active",
          passwordNeedsRehash: false,
        }),
        rehashPassword: async () => undefined,
      })
      .overrideProvider(LOGIN_ABUSE_PROTECTION_PORT)
      .useValue({
        beforeAttempt: async () => ({ delayMs: 0 }),
        recordFailure: async () => undefined,
        recordSuccess: async () => undefined,
      })
      .overrideProvider(CreateSessionUseCase)
      .useValue({
        execute: async (input: unknown) => {
          issued.push(input);
          return { token: "selector.secret", session: {} };
        },
      })
      .overrideProvider(ResolvePendingInvitationLoginUseCase)
      .useValue({
        execute: async () => true,
      })
      .overrideProvider(REDIS_CLIENT_TOKEN)
      .useValue({
        status: "ready",
        quit: async () => "OK",
        disconnect: () => undefined,
      })
      .overrideProvider(POSTGRES_READINESS_PROBE_TOKEN)
      .useValue({ dependency: "postgresql", check: async () => ({ status: "ok", latencyMs: 1 }) })
      .overrideProvider(REDIS_READINESS_PROBE_TOKEN)
      .useValue({ dependency: "redis", check: async () => ({ status: "ok", latencyMs: 1 }) })
      .compile();

    const login = module.get(LoginUseCase);
    await login.execute({
      email: "member@example.test",
      password: "correct horse battery staple",
      ipAddress: "203.0.113.44",
      hostname: HOSTNAME,
      scope: { type: "tenant", tenantId: TENANT_ID },
      requestId: "request-pending-login",
    });

    assert.deepEqual(issued, [
      {
        userId: USER_ID,
        scope: { type: "tenant", tenantId: TENANT_ID },
        hostname: HOSTNAME,
        state: "invitation_pending",
        authorizationVersion: 7,
        requestId: "request-pending-login",
      },
    ]);

    await module.close();
  } finally {
    restoreEnvironment();
  }
});
