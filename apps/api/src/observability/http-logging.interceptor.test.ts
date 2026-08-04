import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createStructuredLogger, type StructuredLogRecord } from "@booking-os/observability";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";

import type { Environment } from "../config/environment.schema.js";
import { EnvironmentService } from "../config/environment.service.js";
import { HttpLoggingInterceptor } from "./http-logging.interceptor.js";
import type { RoutableRequest } from "./route-resolver.js";

interface LoggingRequest extends RoutableRequest {
  readonly requestId: string;
  readonly method: string;
}

class ResponseDouble extends EventEmitter {
  constructor(readonly statusCode: number) {
    super();
  }
}

const environment: Environment = {
  nodeEnvironment: "test",
  host: "127.0.0.1",
  port: 3101,
  apiPrefix: "api",
  appVersion: "0.1.0-test",
  logLevel: "debug",
  databaseUrl: "postgresql://booking:booking@localhost:5432/booking_os_test",
  redisUrl: "redis://localhost:6379/1",
  readinessTimeoutMs: 750,
  sessionSecret: "test-only-session-secret-at-least-32-characters",
  paymentProvider: "mock",
};

function runCompletion(options: {
  readonly request: LoggingRequest;
  readonly statusCode: number;
  readonly clockValues?: readonly number[];
  readonly finishCount?: number;
}): readonly StructuredLogRecord[] {
  const records: StructuredLogRecord[] = [];
  const logger = createStructuredLogger({
    service: "api",
    sink: (record) => records.push(record),
    now: () => new Date("2026-08-04T02:00:00.000Z"),
  });
  const values = [...(options.clockValues ?? [100, 112.3456])];
  const clock = () => values.shift() ?? 112.3456;
  const interceptor = new HttpLoggingInterceptor(
    logger,
    clock,
    new EnvironmentService(environment),
  );
  const response = new ResponseDouble(options.statusCode);
  const context = {
    switchToHttp: () => ({
      getRequest: () => options.request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
  const next = {
    handle: () => of("ok"),
  } satisfies CallHandler;

  interceptor.intercept(context, next);

  for (let index = 0; index < (options.finishCount ?? 1); index += 1) {
    response.emit("finish");
  }

  return records;
}

test("logs one structured completion event with route template and duration", () => {
  const records = runCompletion({
    request: {
      requestId: "request-1",
      method: "GET",
      baseUrl: "/api",
      route: { path: "/bookings/:id" },
    },
    statusCode: 200,
    finishCount: 2,
  });

  assert.equal(records.length, 1);
  assert.deepEqual(records[0], {
    service: "api",
    level: "info",
    message: "http.request_completed",
    requestId: "request-1",
    method: "GET",
    route: "/api/bookings/:id",
    statusCode: 200,
    durationMs: 12.346,
    timestamp: "2026-08-04T02:00:00.000Z",
  });
});

test("uses warn level for server errors", () => {
  const records = runCompletion({
    request: {
      requestId: "request-2",
      method: "POST",
      originalUrl: "/api/fail?token=secret",
    },
    statusCode: 500,
  });

  assert.equal(records[0]?.level, "warn");
  assert.equal(records[0]?.route, "/api/fail");
});

test("suppresses successful liveness and readiness completion logs", () => {
  for (const route of ["/health", "/ready"]) {
    const records = runCompletion({
      request: {
        requestId: `request-${route}`,
        method: "GET",
        baseUrl: "/api",
        route: { path: route },
      },
      statusCode: 200,
    });

    assert.equal(records.length, 0);
  }
});

test("logs unavailable readiness responses", () => {
  const records = runCompletion({
    request: {
      requestId: "request-ready-failed",
      method: "GET",
      baseUrl: "/api",
      route: { path: "/ready" },
    },
    statusCode: 503,
  });

  assert.equal(records.length, 1);
  assert.equal(records[0]?.message, "http.request_completed");
  assert.equal(records[0]?.level, "warn");
});
