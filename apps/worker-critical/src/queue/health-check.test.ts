import assert from "node:assert/strict";
import test from "node:test";

import type { LogContext, StructuredLogger } from "@booking-os/observability";
import { createHealthCheckJobFixture } from "@booking-os/testing";

import { createHealthCheckProcessor, type HealthCheckJobLike } from "./health-check.js";

function createLoggerSpy() {
  const childContexts: LogContext[] = [];
  const infoCalls: Array<{
    message: string;
    context: LogContext | undefined;
  }> = [];
  const errorCalls: Array<{
    message: string;
    error: unknown;
    context: LogContext | undefined;
  }> = [];

  const logger: StructuredLogger = {
    child: (context) => {
      childContexts.push(context);
      return logger;
    },
    debug: () => undefined,
    info: (message, context) => infoCalls.push({ message, context }),
    warn: () => undefined,
    error: (message, error, context) => errorCalls.push({ message, error, context }),
  };

  return { logger, childContexts, infoCalls, errorCalls };
}

test("health-check processor returns a typed critical worker result", async () => {
  const { logger, childContexts, infoCalls } = createLoggerSpy();
  const processor = createHealthCheckProcessor(logger);

  const result = await processor(createHealthCheckJobFixture({ correlationId: "corr-1" }));

  assert.deepEqual(result, {
    service: "worker-critical",
    jobId: "job-1",
    correlationId: "corr-1",
  });
  assert.deepEqual(childContexts, [{ jobId: "job-1", jobName: "health-check" }]);
  assert.deepEqual(
    infoCalls.map(({ message }) => message),
    ["job.started", "job.completed"],
  );
});

test("health-check processor logs invalid payloads and rethrows", async () => {
  const { logger, errorCalls } = createLoggerSpy();
  const processor = createHealthCheckProcessor(logger);
  const invalidJob: HealthCheckJobLike = {
    id: "job-2",
    name: "health-check",
    data: { correlationId: " " },
  };
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;

  try {
    await assert.rejects(() => processor(invalidJob), /correlationId/);
    assert.equal(process.exitCode, undefined);
  } finally {
    process.exitCode = previousExitCode;
  }

  assert.equal(errorCalls.length, 1);
  assert.equal(errorCalls[0]?.message, "job.failed");
  assert.ok(errorCalls[0]?.error instanceof Error);
});

test("health-check processor rejects unexpected job names", async () => {
  const { logger } = createLoggerSpy();
  const processor = createHealthCheckProcessor(logger);

  await assert.rejects(
    () =>
      processor({
        id: "job-3",
        name: "payment.capture",
        data: { correlationId: "corr-3" },
      }),
    /health-check/,
  );
});
