import assert from "node:assert/strict";
import test from "node:test";

import {
  createStructuredLogger,
  type LogContext,
  type StructuredLogRecord,
} from "../src/index.js";

test("writes a structured record with merged child context", () => {
  const records: StructuredLogRecord[] = [];
  const logger = createStructuredLogger({
    service: "worker-critical",
    sink: (record) => records.push(record),
    now: () => new Date("2026-08-03T12:00:00.000Z"),
  });

  logger.child({ jobId: "123", tenantId: undefined }).info("job.completed", {
    jobName: "health-check",
  });

  assert.deepEqual(records, [
    {
      level: "info",
      message: "job.completed",
      service: "worker-critical",
      jobId: "123",
      jobName: "health-check",
      timestamp: "2026-08-03T12:00:00.000Z",
    },
  ]);
  assert.equal(Object.hasOwn(records[0] ?? {}, "tenantId"), false);
});

test("serializes errors without allowing protected field overrides", () => {
  const records: StructuredLogRecord[] = [];
  const logger = createStructuredLogger({
    service: "api",
    sink: (record) => records.push(record),
    now: () => new Date("2026-08-03T12:00:00.000Z"),
  });

  logger.error("bootstrap.failed", new Error("boom"), {
    level: "debug",
    message: "overridden",
    timestamp: "invalid",
    requestId: "request-1",
  });

  const record = records[0];
  assert.equal(record?.level, "error");
  assert.equal(record?.message, "bootstrap.failed");
  assert.equal(record?.timestamp, "2026-08-03T12:00:00.000Z");
  assert.equal(record?.requestId, "request-1");
  assert.equal(record?.error?.name, "Error");
  assert.equal(record?.error?.message, "boom");
  assert.equal(typeof record?.error?.stack, "string");
});

test("serializes non-Error failures", () => {
  const records: StructuredLogRecord[] = [];
  const logger = createStructuredLogger({
    service: "worker-batch",
    sink: (record) => records.push(record),
  });

  logger.error("job.failed", "bad payload");

  assert.deepEqual(records[0]?.error, {
    name: "Error",
    message: "bad payload",
  });
});

test("merges dynamic request context into each log record", () => {
  const records: StructuredLogRecord[] = [];
  let requestId = "req-1";
  const logger = createStructuredLogger({
    service: "api",
    sink: (record) => records.push(record),
    now: () => new Date("2026-08-04T04:30:00.000Z"),
    contextProvider: () => ({
      requestId,
      traceId: "550e8400-e29b-41d4-a716-446655440000",
    }),
  });

  logger.info("request.started");
  requestId = "req-2";
  logger.info("request.completed", { tenantId: "tenant-1" });

  assert.equal(records[0]?.requestId, "req-1");
  assert.equal(records[1]?.requestId, "req-2");
  assert.equal(records[1]?.traceId, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(records[1]?.tenantId, "tenant-1");
});

test("redacts nested sensitive context before writing to the sink", () => {
  const records: StructuredLogRecord[] = [];
  const logger = createStructuredLogger({
    service: "api",
    sink: (record) => records.push(record),
    now: () => new Date("2026-08-10T12:00:00.000Z"),
  });
  const context = {
    requestId: "req-1",
    password: "plaintext-password",
    metadata: {
      accessToken: "plaintext-token",
      safe: "visible",
      nested: [{ refresh_token: "plaintext-refresh" }],
    },
  } as unknown as LogContext;

  logger.info("auth.request", context);

  const record = records[0] as unknown as {
    password?: unknown;
    metadata?: unknown;
  };
  assert.equal(record.password, "[REDACTED]");
  assert.deepEqual(record.metadata, {
    accessToken: "[REDACTED]",
    safe: "visible",
    nested: [{ refresh_token: "[REDACTED]" }],
  });
});
