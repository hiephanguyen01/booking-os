import assert from "node:assert/strict";
import test from "node:test";

import type { StructuredLogger } from "@booking-os/observability";
import { BadRequestException } from "@nestjs/common";

import { ApiError } from "./api-error.js";
import { ApiExceptionFilter } from "./api-exception.filter.js";
import type { RequestContextStorage } from "../request-context/request-context.storage.js";

function createLogger(errors: unknown[]): StructuredLogger {
  return {
    child() {
      return this;
    },
    debug() {},
    info() {},
    warn() {},
    error(_message, error) {
      errors.push(error);
    },
  };
}

test("maps unexpected errors without leaking exception messages", () => {
  const filter = new ApiExceptionFilter({} as RequestContextStorage, createLogger([]));

  const result = filter.format(new Error("database password=secret"), "req-1");

  assert.deepEqual(result, {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId: "req-1",
    },
  });
});

test("preserves explicit domain error codes and safe details", () => {
  const filter = new ApiExceptionFilter({} as RequestContextStorage, createLogger([]));

  const result = filter.format(
    new ApiError({
      code: "BOOKING_SLOT_UNAVAILABLE",
      message: "The selected slot is no longer available.",
      statusCode: 409,
      details: { listingId: "listing-1" },
    }),
    "req-2",
  );

  assert.deepEqual(result, {
    error: {
      code: "BOOKING_SLOT_UNAVAILABLE",
      message: "The selected slot is no longer available.",
      requestId: "req-2",
      details: { listingId: "listing-1" },
    },
  });
});

test("maps validation messages to a stable validation envelope", () => {
  const filter = new ApiExceptionFilter({} as RequestContextStorage, createLogger([]));

  const result = filter.format(
    new BadRequestException({
      statusCode: 400,
      error: "Bad Request",
      message: ["email must be an email", "phone should not be empty"],
    }),
    "req-3",
  );

  assert.deepEqual(result, {
    error: {
      code: "VALIDATION_ERROR",
      message: "Request validation failed.",
      requestId: "req-3",
      details: {
        messages: ["email must be an email", "phone should not be empty"],
      },
    },
  });
});

test("catch logs an unexpected error and returns HTTP 500", () => {
  const loggedErrors: unknown[] = [];
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const storage = {
    get: () => ({ requestId: "req-4", traceId: "trace-4" }),
  } as RequestContextStorage;
  const filter = new ApiExceptionFilter(storage, createLogger(loggedErrors));
  const failure = new Error("sensitive failure");
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
    }),
  };

  filter.catch(failure, host as never);

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.body, {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
      requestId: "req-4",
    },
  });
  assert.deepEqual(loggedErrors, [failure]);
});
