import assert from "node:assert/strict";
import test from "node:test";

import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";

import { normalizeApiError } from "./api-error-response.js";

test("normalizes a client error into the public API envelope", () => {
  assert.deepEqual(
    normalizeApiError(new BadRequestException("Invalid input"), "request-1"),
    {
      statusCode: 400,
      body: {
        statusCode: 400,
        error: "Bad Request",
        message: "Invalid input",
        requestId: "request-1",
      },
    },
  );
});

test("preserves safe validation arrays and ignores extra payload fields", () => {
  const exception = new BadRequestException({
    message: ["email is required", "name must be a string"],
    error: "Validation Failed",
    query: "internal=true",
    details: { field: "internal-only" },
  });

  assert.deepEqual(normalizeApiError(exception, "request-2"), {
    statusCode: 400,
    body: {
      statusCode: 400,
      error: "Validation Failed",
      message: ["email is required", "name must be a string"],
      requestId: "request-2",
    },
  });
});

test("hides internal server-side exception messages", () => {
  const exception = new ServiceUnavailableException("internal dependency detail");

  assert.deepEqual(normalizeApiError(exception, "request-3"), {
    statusCode: 503,
    body: {
      statusCode: 503,
      error: "Service Unavailable",
      message: "An unexpected error occurred",
      requestId: "request-3",
    },
  });
});

test("maps unknown failures to a fixed 500 response", () => {
  assert.deepEqual(
    normalizeApiError(new Error("internal runtime detail"), "request-4"),
    {
      statusCode: 500,
      body: {
        statusCode: 500,
        error: "Internal Server Error",
        message: "An unexpected error occurred",
        requestId: "request-4",
      },
    },
  );
});
