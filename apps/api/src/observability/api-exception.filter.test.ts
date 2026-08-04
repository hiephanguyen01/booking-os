import assert from "node:assert/strict";
import test from "node:test";

import { createStructuredLogger, type StructuredLogRecord } from "@booking-os/observability";
import { BadRequestException, type ArgumentsHost } from "@nestjs/common";

import { ApiExceptionFilter } from "./api-exception.filter.js";

interface ResponseDouble {
  statusCode: number;
  body?: unknown;
  status(code: number): ResponseDouble;
  json(body: unknown): ResponseDouble;
}

function createResponse(): ResponseDouble {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createHost(request: object, response: object): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as ArgumentsHost;
}

test("writes the normalized response and exactly one safe failure event", () => {
  const records: StructuredLogRecord[] = [];
  const logger = createStructuredLogger({
    service: "api",
    sink: (record) => records.push(record),
    now: () => new Date("2026-08-04T00:00:00.000Z"),
  });
  const response = createResponse();
  const request = {
    requestId: "request-1",
    method: "POST",
    originalUrl: "/api/bookings?customer=internal",
    body: { field: "internal-only" },
    query: { customer: "internal" },
    headers: { authorization: "internal" },
    cookies: { session: "internal" },
    environment: { NODE_ENV: "test" },
  };
  const exception = new BadRequestException("Invalid booking");

  new ApiExceptionFilter(logger).catch(exception, createHost(request, response));

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.body, {
    statusCode: 400,
    error: "Bad Request",
    message: "Invalid booking",
    requestId: "request-1",
  });
  assert.equal(records.length, 1);
  assert.equal(records[0]?.message, "http.request_failed");
  assert.equal(records[0]?.requestId, "request-1");
  assert.equal(records[0]?.method, "POST");
  assert.equal(records[0]?.route, "/api/bookings");
  assert.equal(records[0]?.statusCode, 400);
  assert.equal(records[0]?.error?.message, "Invalid booking");

  for (const forbidden of ["body", "query", "headers", "cookies", "environment"]) {
    assert.equal(Object.hasOwn(records[0] ?? {}, forbidden), false);
  }
});
