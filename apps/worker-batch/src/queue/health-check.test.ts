import assert from "node:assert/strict";
import test from "node:test";

import type {
  LogContext,
  StructuredLogger,
} from "@booking-os/observability";
import { createHealthCheckJobFixture } from "@booking-os/testing";

import {
  createHealthCheckProcessor,
  type HealthCheckJobLike,
} from "./health-check.js";

function createLoggerSpy() {
  const childContexts: LogContext[] = [];
  const infoMessages: string[] = [];
  const errors: Array<{ message: string; error: unknown }> = [];

  const logger: StructuredLogger = {
    child: (context) => {
      childContexts.push(context);
      return logger;
    },
    debug: () => undefined,
    info: (message) => infoMessages.push(message),
    warn: () => undefined,
    error: (message, error) => errors.push({ message, error }),
  };

  return { logger, childContexts, infoMessages, errors };
}

test("health-check processor returns a typed batch worker result", async () => {
  const { logger, childContexts, infoMessages } = createLoggerSpy();
  const processor = createHealthCheckProcessor(logger);

  assert.deepEqual(
    await processor(createHealthCheckJobFixture({ correlationId: "corr-1" })),
    {
      service: "worker-batch",
      jobId: "job-1",
      correlationId: "corr-1",
    },
  );
  assert.deepEqual(childContexts, [
    { jobId: "job-1", jobName: "health-check" },
  ]);
  assert.deepEqual(infoMessages, ["job.started", "job.completed"]);
});

test("health-check processor logs failures, rethrows, and never exits", async () => {
  const { logger, errors } = createLoggerSpy();
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

  assert.equal(errors.length, 1);
  assert.equal(errors[0]?.message, "job.failed");
  assert.ok(errors[0]?.error instanceof Error);
});

test("health-check processor rejects unexpected job names", async () => {
  const { logger } = createLoggerSpy();
  const processor = createHealthCheckProcessor(logger);

  await assert.rejects(
    () => processor({ id: "job-3", name: "report.generate", data: {} }),
    /health-check/,
  );
});
