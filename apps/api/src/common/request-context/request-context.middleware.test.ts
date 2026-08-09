import assert from "node:assert/strict";
import test from "node:test";

import { RequestContextMiddleware } from "./request-context.middleware.js";
import { RequestContextStorage } from "./request-context.storage.js";

interface FakeRequest {
  readonly headers: Record<string, string | string[] | undefined>;
}

interface FakeResponse {
  readonly headers: Record<string, string>;
  setHeader(name: string, value: string): void;
}

function createResponse(): FakeResponse {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
  };
}

test("uses a valid incoming request ID and creates a trace ID", () => {
  const storage = new RequestContextStorage();
  const middleware = new RequestContextMiddleware(storage);
  const response = createResponse();
  let observedContext: ReturnType<RequestContextStorage["require"]> | undefined;

  middleware.use({ headers: { "x-request-id": "req-client-123" } } as FakeRequest, response, () => {
    observedContext = storage.require();
  });

  assert.equal(observedContext?.requestId, "req-client-123");
  assert.match(observedContext?.traceId ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(observedContext?.source, "internal");
  assert.equal(response.headers["x-request-id"], "req-client-123");
  assert.equal(response.headers["x-trace-id"], observedContext?.traceId);
});

test("replaces invalid incoming identifiers", () => {
  const storage = new RequestContextStorage();
  const middleware = new RequestContextMiddleware(storage);
  const response = createResponse();
  let observedContext: ReturnType<RequestContextStorage["require"]> | undefined;

  middleware.use(
    {
      headers: {
        "x-request-id": "invalid request id with spaces",
        "x-trace-id": "not-a-uuid",
      },
    } as FakeRequest,
    response,
    () => {
      observedContext = storage.require();
    },
  );

  assert.match(observedContext?.requestId ?? "", /^[0-9a-f-]{36}$/);
  assert.match(observedContext?.traceId ?? "", /^[0-9a-f-]{36}$/);
  assert.notEqual(observedContext?.requestId, observedContext?.traceId);
});

test("preserves a valid incoming trace ID separately from request ID", () => {
  const storage = new RequestContextStorage();
  const middleware = new RequestContextMiddleware(storage);
  const response = createResponse();
  const traceId = "550e8400-e29b-41d4-a716-446655440000";
  let observedContext: ReturnType<RequestContextStorage["require"]> | undefined;

  middleware.use(
    {
      headers: {
        "x-request-id": "req-client-456",
        "x-trace-id": traceId,
      },
    } as FakeRequest,
    response,
    () => {
      observedContext = storage.require();
    },
  );

  assert.equal(observedContext?.requestId, "req-client-456");
  assert.equal(observedContext?.traceId, traceId);
});

test("does not trust source tenant identity session role permission or version headers", () => {
  const storage = new RequestContextStorage();
  const middleware = new RequestContextMiddleware(storage);
  const response = createResponse();
  let observedContext: ReturnType<RequestContextStorage["require"]> | undefined;

  middleware.use(
    {
      headers: {
        "x-source": "worker",
        "x-tenant-id": "550e8400-e29b-41d4-a716-446655440000",
        "x-actor-id": "attacker",
        "x-user-id": "attacker-user",
        "x-session-id": "attacker-session",
        "x-role": "platform_admin",
        "x-permission": "platform.tenants.provision",
        "x-authorization-version": "999",
      },
    } as FakeRequest,
    response,
    () => {
      observedContext = storage.require();
    },
  );

  assert.equal(observedContext?.source, "internal");
  assert.equal(observedContext?.tenantId, undefined);
  assert.equal(observedContext?.actorId, undefined);
  assert.equal("sessionId" in (observedContext ?? {}), false);
  assert.equal("roleKeys" in (observedContext ?? {}), false);
  assert.equal("permissionKeys" in (observedContext ?? {}), false);
  assert.equal("authorizationVersion" in (observedContext ?? {}), false);
});
