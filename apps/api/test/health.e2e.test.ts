import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import type { HealthResponse } from "@booking-os/contracts/health";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { AppModule } from "../src/app.module.js";

let app: INestApplication;

before(async () => {
  const testingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = testingModule.createNestApplication();
  app.setGlobalPrefix("api");

  await app.init();
});

after(async () => {
  await app.close();
});

test("GET /api/health returns the liveness response", async () => {
  const response = await request(app.getHttpServer()).get("/api/health").expect(200);

  const body = response.body as HealthResponse;

  assert.equal(body.service, "api");
  assert.equal(body.status, "ok");
  assert.equal(typeof body.timestamp, "string");
  assert.equal(typeof body.uptimeSeconds, "number");
});

test("GET /api/ready returns the readiness response", async () => {
  const response = await request(app.getHttpServer()).get("/api/ready").expect(200);

  const body = response.body as HealthResponse;

  assert.equal(body.status, "ok");
  assert.deepEqual(body.dependencies, {});
});
