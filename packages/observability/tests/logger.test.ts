import assert from "node:assert/strict";
import test from "node:test";

import { createStructuredLogger, type StructuredLogRecord } from "../src/index.js";

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
