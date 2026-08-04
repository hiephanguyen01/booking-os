import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import type { HealthResponse } from "@booking-os/contracts/health";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";

let app: INestApplication;

const originalEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  HOST: process.env.HOST,
  PORT: process.env.PORT,
  API_PREFIX: process.env.API_PREFIX,
  APP_VERSION: process.env.APP_VERSION,
  LOG_LEVEL: process.env.LOG_LEVEL,
  DATABASE_URL: process.env.DATABASE_URL,
  REDIS_URL: process.env.REDIS_URL,
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

before(async () => {
  process.env.NODE_ENV = "test";
  process.env.HOST = "127.0.0.1";
  process.env.PORT = "3101";
  process.env.API_PREFIX = "api";
  process.env.APP_VERSION = "0.1.0-e2e";
  process.env.LOG_LEVEL = "error";
  process.env.DATABASE_URL = "postgresql://booking:booking@localhost:5432/booking_os_test";
  process.env.REDIS_URL = "redis://localhost:6379/1";
  process.env.SESSION_SECRET = "test-only-session-secret-at-least-32-characters";
  process.env.PAYMENT_PROVIDER = "mock";

  const testingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = testingModule.createNestApplication();

  app.setGlobalPrefix("api");

  await app.init();
});

after(async () => {
  await app.close();

  for (const key of Object.keys(originalEnvironment) as Array<keyof typeof originalEnvironment>) {
    restoreEnvironmentValue(key);
  }
});

test("GET /api/health returns the liveness response", async () => {
  const response = await request(app.getHttpServer()).get("/api/health").expect(200);

  const body = response.body as HealthResponse;

  assert.equal(body.service, "api");
  assert.equal(body.status, "ok");
  assert.equal(body.version, "0.1.0-e2e");
  assert.equal(typeof body.timestamp, "string");
  assert.equal(typeof body.uptimeSeconds, "number");
});

test("GET /api/ready returns the readiness response", async () => {
  const response = await request(app.getHttpServer()).get("/api/ready").expect(200);

  const body = response.body as HealthResponse;

  assert.equal(body.status, "ok");
  assert.deepEqual(body.dependencies, {});
});
