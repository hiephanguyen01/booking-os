import assert from "node:assert/strict";
import test from "node:test";

import type {
  LogContext,
  StructuredLogger,
} from "@booking-os/observability";

import {
  logApiBootstrapFailure,
  logApiReady,
} from "./bootstrap-events.js";

function createLoggerSpy() {
  const infoCalls: Array<{ message: string; context?: LogContext }> = [];
  const errorCalls: Array<{
    message: string;
    error: unknown;
    context?: LogContext;
  }> = [];

  const logger: StructuredLogger = {
    child: () => logger,
    debug: () => undefined,
    info: (message, context) => infoCalls.push({ message, context }),
    warn: () => undefined,
    error: (message, error, context) =>
      errorCalls.push({ message, error, context }),
  };

  return { logger, infoCalls, errorCalls };
}

test("logApiReady emits a structured ready event", () => {
  const { logger, infoCalls } = createLoggerSpy();

  logApiReady(logger, {
    environment: "development",
    address: "http://localhost:3000/api",
  });

  assert.deepEqual(infoCalls, [
    {
      message: "service.ready",
      context: {
        environment: "development",
        address: "http://localhost:3000/api",
      },
    },
  ]);
});

test("logApiBootstrapFailure emits the original failure", () => {
  const { logger, errorCalls } = createLoggerSpy();
  const failure = new Error("listen failed");

  logApiBootstrapFailure(logger, failure);

  assert.deepEqual(errorCalls, [
    {
      message: "service.bootstrap_failed",
      error: failure,
      context: undefined,
    },
  ]);
});
