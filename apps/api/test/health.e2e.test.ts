import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import type { HealthDependencyStatus, HealthResponse } from "@booking-os/contracts/health";
import {
  createStructuredLogger,
  type StructuredLogger,
  type StructuredLogRecord,
} from "@booking-os/observability";
import { Controller, Get, type INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";
import {
  POSTGRES_READINESS_PROBE_TOKEN,
  REDIS_READINESS_PROBE_TOKEN,
} from "../src/dependencies/tokens.js";
import { API_LOGGER_TOKEN, REQUEST_ID_GENERATOR_TOKEN } from "../src/observability/tokens.js";

@Controller("test")
class TestErrorController {
  @Get("boom")
  boom(): never {
    throw new Error("internal database detail");
  }
}

interface TestApplication {
  readonly app: INestApplication;
  readonly records: StructuredLogRecord[];
}

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
};

function restoreEnvironmentValue(key: keyof typeof originalEnvironment): void {
  const originalValue = originalEnvironment[key];
  if (originalValue === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = originalValue;
}

function createCapturedLogger(records: StructuredLogRecord[]): StructuredLogger {
  return createStructuredLogger({
    service: "api",
    sink: (record) => records.push(record),
    now: () => new Date("2026-08-04T00:00:00.000Z"),
  });
}

async function createTestApplication(
  postgresStatus: HealthDependencyStatus = { status: "ok", latencyMs: 1 },
  redisStatus: HealthDependencyStatus = { status: "ok", latencyMs: 2 },
): Promise<TestApplication> {
  const records: StructuredLogRecord[] = [];
  const postgresProbe = {
    dependency: "postgresql" as const,
    check: async () => postgresStatus,
  };
  const redisProbe = {
    dependency: "redis" as const,
    check: async () => redisStatus,
  };

  const testingModule = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [TestErrorController],
  })
    .overrideProvider(POSTGRES_READINESS_PROBE_TOKEN)
    .useValue(postgresProbe)
    .overrideProvider(REDIS_READINESS_PROBE_TOKEN)
    .useValue(redisProbe)
    .overrideProvider(API_LOGGER_TOKEN)
    .useValue(createCapturedLogger(records))
    .overrideProvider(REQUEST_ID_GENERATOR_TOKEN)
    .useValue(() => "generated-request-id")
    .compile();

  const app = testingModule.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();
  return { app, records };
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
});

after(() => {
  for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
    restoreEnvironmentValue(key);
  }
});

test("GET /api/health generates a request ID and suppresses successful probe logs", async () => {
  const { app, records } = await createTestApplication();
  try {
    const response = await request(app.getHttpServer()).get("/api/health").expect(200);
    const body = response.body as HealthResponse;

    assert.equal(response.headers["x-request-id"], "generated-request-id");
    assert.equal(body.service, "api");
    assert.equal(body.status, "ok");
    assert.equal(body.version, "0.1.0-e2e");
    assert.equal(
      records.some((record) => record.message === "http.request_completed"),
      false,
    );
  } finally {
    await app.close();
  }
});

test("preserves valid request IDs and replaces invalid ones", async () => {
  const { app } = await createTestApplication();
  try {
    const valid = await request(app.getHttpServer())
      .get("/api/health")
      .set("x-request-id", "upstream.request-1")
      .expect(200);
    const invalid = await request(app.getHttpServer())
      .get("/api/health")
      .set("x-request-id", "invalid request id")
      .expect(200);

    assert.equal(valid.headers["x-request-id"], "upstream.request-1");
    assert.equal(invalid.headers["x-request-id"], "generated-request-id");
  } finally {
    await app.close();
  }
});

test("GET /api/ready returns 200 when both dependencies are ready", async () => {
  const { app } = await createTestApplication();
  try {
    const response = await request(app.getHttpServer()).get("/api/ready").expect(200);
    const body = response.body as HealthResponse;

    assert.equal(body.status, "ok");
    assert.deepEqual(body.dependencies, {
      postgresql: { status: "ok", latencyMs: 1 },
      redis: { status: "ok", latencyMs: 2 },
    });
  } finally {
    await app.close();
  }
});

test("GET /api/ready returns 503 and logs the unavailable Redis probe", async () => {
  const { app, records } = await createTestApplication(
    { status: "ok", latencyMs: 1 },
    { status: "unavailable", latencyMs: 2, message: "connection_failed" },
  );
  try {
    const response = await request(app.getHttpServer())
      .get("/api/ready")
      .set("x-request-id", "readiness-request")
      .expect(503);
    const body = response.body as HealthResponse;

    assert.equal(body.status, "unavailable");
    assert.deepEqual(body.dependencies?.postgresql, { status: "ok", latencyMs: 1 });
    assert.deepEqual(body.dependencies?.redis, {
      status: "unavailable",
      latencyMs: 2,
      message: "connection_failed",
    });
    const failure = records.find((record) => record.message === "readiness.probe_failed");
    assert.equal(failure?.requestId, "readiness-request");
    assert.equal(failure?.dependency, "redis");
    assert.equal(failure?.reason, "connection_failed");
    assert.equal(
      records.some((record) => record.message === "http.request_completed"),
      true,
    );
  } finally {
    await app.close();
  }
});

test("unhandled failures return a redacted envelope with matching request IDs and logs", async () => {
  const { app, records } = await createTestApplication();
  try {
    const response = await request(app.getHttpServer())
      .get("/api/test/boom")
      .set("x-request-id", "failure-request")
      .expect(500);

    assert.equal(response.headers["x-request-id"], "failure-request");
    assert.deepEqual(response.body, {
      statusCode: 500,
      error: "Internal Server Error",
      message: "An unexpected error occurred",
      requestId: "failure-request",
    });
    assert.equal(JSON.stringify(response.body).includes("internal database detail"), false);
    assert.equal(records.filter((record) => record.message === "http.request_failed").length, 1);
    assert.equal(records.filter((record) => record.message === "http.request_completed").length, 1);
    assert.equal(
      records.find((record) => record.message === "http.request_failed")?.requestId,
      "failure-request",
    );
  } finally {
    await app.close();
  }
});
