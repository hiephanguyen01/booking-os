import assert from "node:assert/strict";
import test from "node:test";
import type { NextFunction, Response } from "express";

import type { RequestWithContext } from "./request-context.js";
import { RequestIdMiddleware } from "./request-id.middleware.js";

function runMiddleware(header: string | string[] | undefined): {
  readonly requestId: string;
  readonly responseHeader: unknown;
  readonly nextCalls: number;
} {
  const middleware = new RequestIdMiddleware(() => "generated-1");
  const request = {
    headers: {
      ...(header === undefined ? {} : { "x-request-id": header }),
    },
  } as RequestWithContext;
  const headers = new Map<string, unknown>();
  const response = {
    setHeader(name: string, value: unknown) {
      headers.set(name.toLowerCase(), value);
      return this;
    },
  } as unknown as Response;
  let nextCalls = 0;
  const next = (() => {
    nextCalls += 1;
  }) as NextFunction;

  middleware.use(request, response, next);

  return {
    requestId: request.requestId,
    responseHeader: headers.get("x-request-id"),
    nextCalls,
  };
}

test("preserves and echoes a valid upstream request ID", () => {
  assert.deepEqual(runMiddleware("gateway-request-1"), {
    requestId: "gateway-request-1",
    responseHeader: "gateway-request-1",
    nextCalls: 1,
  });
});

test("replaces and never echoes an invalid upstream request ID", () => {
  assert.deepEqual(runMiddleware("bad\nvalue"), {
    requestId: "generated-1",
    responseHeader: "generated-1",
    nextCalls: 1,
  });
});

test("generates and echoes an ID when the header is missing", () => {
  assert.deepEqual(runMiddleware(undefined), {
    requestId: "generated-1",
    responseHeader: "generated-1",
    nextCalls: 1,
  });
});
