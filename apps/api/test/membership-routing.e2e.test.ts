import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import {
  BOOKING_SESSION_COOKIE,
  createSessionToken,
  PERMISSION_KEYS,
  SYSTEM_ROLES,
} from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";
import type { AuthenticatedRequestContext } from "../src/common/request-context/request-context.types.js";
import {
  POSTGRES_READINESS_PROBE_TOKEN,
  REDIS_READINESS_PROBE_TOKEN,
} from "../src/dependencies/tokens.js";
import { BuildAuthorizationContextUseCase } from "../src/modules/authorization/application/use-cases/build-authorization-context.use-case.js";
import { BuildTenantAuthorizationContextUseCase } from "../src/modules/memberships/application/use-cases/build-tenant-authorization-context.use-case.js";
import {
  type ListMembershipsCommand,
  ListMembershipsUseCase,
} from "../src/modules/memberships/application/use-cases/list-memberships.use-case.js";
import {
  type GetCurrentSessionInput,
  GetCurrentSessionUseCase,
} from "../src/modules/sessions/application/use-cases/get-current-session.use-case.js";
import { ResolveTenantUseCase } from "../src/modules/tenancy/application/use-cases/resolve-tenant.use-case.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_SLUG = "studio";
const HOSTNAME = `${TENANT_SLUG}.example.test`;
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const MEMBERSHIP_ID = "44444444-4444-4444-8444-444444444444";
const SESSION_TOKEN = createSessionToken();

const AUTHORIZATION: AuthorizationContext = {
  userId: ACTOR_ID,
  sessionId: SESSION_ID,
  scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: TENANT_SLUG },
  membershipId: MEMBERSHIP_ID,
  membershipStatus: "active",
  roleKeys: [SYSTEM_ROLES.tenantOwner],
  permissionKeys: [PERMISSION_KEYS.tenantMembershipRead],
  userAuthorizationVersion: 3,
  membershipAuthorizationVersion: 2,
};

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

interface CompositionObservations {
  readonly resolvedHostnames: string[];
  readonly sessionInputs: GetCurrentSessionInput[];
  readonly guardAuthorizationInputs: AuthenticatedRequestContext[];
  readonly authorizationInputs: AuthenticatedRequestContext[];
  readonly listCommands: ListMembershipsCommand[];
}

async function createTestApplication(): Promise<{
  readonly app: INestApplication;
  readonly observations: CompositionObservations;
  readonly setGuardAuthorization: (authorization: AuthorizationContext) => void;
}> {
  let guardAuthorization = AUTHORIZATION;
  const observations: CompositionObservations = {
    resolvedHostnames: [],
    sessionInputs: [],
    guardAuthorizationInputs: [],
    authorizationInputs: [],
    listCommands: [],
  };

  const testingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(POSTGRES_READINESS_PROBE_TOKEN)
    .useValue({ dependency: "postgresql", check: async () => ({ status: "ok", latencyMs: 1 }) })
    .overrideProvider(REDIS_READINESS_PROBE_TOKEN)
    .useValue({ dependency: "redis", check: async () => ({ status: "ok", latencyMs: 1 }) })
    .overrideProvider(ResolveTenantUseCase)
    .useValue({
      execute: async (hostname: string) => {
        observations.resolvedHostnames.push(hostname);
        return hostname === HOSTNAME ? { id: TENANT_ID, slug: TENANT_SLUG } : null;
      },
    })
    .overrideProvider(GetCurrentSessionUseCase)
    .useValue({
      execute: async (input: GetCurrentSessionInput) => {
        observations.sessionInputs.push(input);
        return {
          actorId: ACTOR_ID,
          sessionId: SESSION_ID,
          authScope: { type: "tenant" as const, tenantId: TENANT_ID },
          sessionState: "active" as const,
          authorizationVersion: 3,
          membershipAuthorizationVersion: 2,
          tokenDisposition: "active" as const,
          rotationRequired: false,
        };
      },
    })
    .overrideProvider(BuildAuthorizationContextUseCase)
    .useValue({
      execute: async (authenticated: AuthenticatedRequestContext) => {
        observations.guardAuthorizationInputs.push(authenticated);
        return guardAuthorization;
      },
    })
    .overrideProvider(BuildTenantAuthorizationContextUseCase)
    .useValue({
      execute: async (authenticated: AuthenticatedRequestContext) => {
        observations.authorizationInputs.push(authenticated);
        return AUTHORIZATION;
      },
    })
    .overrideProvider(ListMembershipsUseCase)
    .useValue({
      execute: async (command: ListMembershipsCommand) => {
        observations.listCommands.push(command);
        return [
          {
            id: MEMBERSHIP_ID,
            userId: ACTOR_ID,
            status: "active" as const,
            authorizationVersion: 2,
            roleKeys: [SYSTEM_ROLES.tenantOwner],
          },
        ];
      },
    })
    .compile();

  const app = testingModule.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  return {
    app,
    observations,
    setGuardAuthorization: (authorization) => {
      guardAuthorization = authorization;
    },
  };
}

before(() => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.TRUST_PROXY = "false";
  process.env.TENANT_BASE_DOMAIN = "example.test";
  process.env.PLATFORM_HOSTNAME = "platform.example.test";
  process.env.PORT = "3131";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL = "postgresql://local-user:local-pass@localhost:5432/booking_os_test";
  process.env.REDIS_URL = "redis://localhost:6379/1";
  process.env.READINESS_TIMEOUT_MS = "100";
  process.env.SESSION_SECRET = "membership-routing-e2e-secret-32-characters";
  process.env.PAYMENT_PROVIDER = "mock";
});

after(() => {
  for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
    restoreEnvironmentValue(key);
  }
});

test("AppModule resolves tenant authentication before listing memberships", async () => {
  const { app, observations, setGuardAuthorization } = await createTestApplication();

  try {
    const response = await request(app.getHttpServer())
      .get("/api/memberships")
      .set("host", HOSTNAME)
      .set("cookie", `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(SESSION_TOKEN)}`)
      .expect(200);

    assert.deepEqual(response.body, [
      {
        id: MEMBERSHIP_ID,
        userId: ACTOR_ID,
        status: "active",
        authorizationVersion: 2,
        roleKeys: [SYSTEM_ROLES.tenantOwner],
      },
    ]);
    assert.deepEqual(observations.resolvedHostnames, [HOSTNAME]);
    assert.equal(observations.sessionInputs.length, 1);
    assert.deepEqual(observations.sessionInputs[0]?.scope, { type: "tenant", tenantId: TENANT_ID });
    assert.equal(observations.sessionInputs[0]?.hostname, HOSTNAME);
    assert.equal(observations.sessionInputs[0]?.token, SESSION_TOKEN);
    assert.equal(typeof observations.sessionInputs[0]?.requestId, "string");
    assert.notEqual(observations.sessionInputs[0]?.requestId, "");
    assert.equal(observations.guardAuthorizationInputs.length, 1);
    assert.equal(
      observations.guardAuthorizationInputs[0]?.requestId,
      observations.sessionInputs[0]?.requestId,
    );
    assert.equal(observations.authorizationInputs.length, 0);
    assert.equal(observations.guardAuthorizationInputs[0]?.membershipAuthorizationVersion, 2);
    assert.deepEqual(observations.listCommands, [
      { authorization: AUTHORIZATION, requestId: observations.sessionInputs[0]?.requestId },
    ]);

    setGuardAuthorization({ ...AUTHORIZATION, permissionKeys: [] });
    await request(app.getHttpServer())
      .get("/api/memberships")
      .set("host", HOSTNAME)
      .set("cookie", `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(SESSION_TOKEN)}`)
      .expect(403);
    assert.equal(observations.listCommands.length, 1);
  } finally {
    await app.close();
  }
});
