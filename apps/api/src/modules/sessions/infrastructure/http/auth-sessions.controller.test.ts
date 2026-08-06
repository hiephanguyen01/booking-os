import assert from "node:assert/strict";
import test from "node:test";

import { serializeExpiredSessionCookie } from "@booking-os/auth";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import type { SessionSummary } from "../../application/use-cases/list-sessions.js";
import { AuthController } from "./auth.controller.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_SESSION_ID = "55555555-5555-4555-8555-555555555555";

const AUTHENTICATED_CONTEXT = Object.freeze({
  requestId: "request-list-sessions",
  traceId: "44444444-4444-4444-8444-444444444444",
  source: "console" as const,
  actorId: USER_ID,
  sessionId: SESSION_ID,
  authScope: { type: "platform" as const },
  sessionState: "active" as const,
});

function responseHeaders(): {
  readonly headers: Map<string, string>;
  readonly response: { setHeader(name: string, value: string): void };
} {
  const headers = new Map<string, string>();
  return {
    headers,
    response: {
      setHeader(name: string, value: string) {
        headers.set(name.toLowerCase(), value);
      },
    },
  };
}

test("lists public device summaries for the trusted actor and marks the current session", async () => {
  const storage = new RequestContextStorage();
  const calls: unknown[] = [];
  const summary: SessionSummary = {
    id: SESSION_ID,
    scope: { type: "platform" },
    hostname: "console.example.com",
    state: "active",
    current: true,
    createdAt: new Date("2026-08-06T01:30:00.000Z"),
    lastSeenAt: new Date("2026-08-06T01:50:00.000Z"),
    idleExpiresAt: new Date("2026-08-13T02:00:00.000Z"),
    absoluteExpiresAt: new Date("2026-09-05T02:00:00.000Z"),
  };
  const listSessions = {
    async execute(input: unknown) {
      calls.push(input);
      return [summary];
    },
  };
  const controller = Reflect.construct(AuthController, [
    { execute: async () => assert.fail("login must not run") },
    storage,
    { trustProxy: false },
    undefined,
    listSessions,
  ]) as AuthController & {
    sessions(response: { setHeader(name: string, value: string): void }): Promise<{
      readonly sessions: readonly SessionSummary[];
    }>;
  };
  const { headers, response } = responseHeaders();

  await storage.run(AUTHENTICATED_CONTEXT, async () => {
    assert.deepEqual(await controller.sessions(response), { sessions: [summary] });
  });

  assert.deepEqual(calls, [{ userId: USER_ID, currentSessionId: SESSION_ID }]);
  assert.equal(headers.get("cache-control"), "private, no-store");
  assert.equal(headers.has("set-cookie"), false);
});

test("revokes another device for the trusted actor without clearing the current cookie", async () => {
  const storage = new RequestContextStorage();
  const calls: unknown[] = [];
  const revokeSession = {
    async execute(input: unknown) {
      calls.push(input);
      return { revoked: true };
    },
  };
  const controller = Reflect.construct(AuthController, [
    { execute: async () => assert.fail("login must not run") },
    storage,
    { trustProxy: false },
    revokeSession,
  ]) as AuthController & {
    revokeSession(
      sessionId: string,
      response: { setHeader(name: string, value: string): void },
    ): Promise<{ readonly revoked: boolean }>;
  };
  const { headers, response } = responseHeaders();

  await storage.run(AUTHENTICATED_CONTEXT, async () => {
    assert.deepEqual(await controller.revokeSession(OTHER_SESSION_ID, response), {
      revoked: true,
    });
  });

  assert.deepEqual(calls, [
    {
      sessionId: OTHER_SESSION_ID,
      userId: USER_ID,
      reason: "device_revoked",
      requestId: "request-list-sessions",
    },
  ]);
  assert.equal(headers.get("cache-control"), "private, no-store");
  assert.equal(headers.has("set-cookie"), false);
});

test("expires the host cookie when the current device is revoked", async () => {
  const storage = new RequestContextStorage();
  const revokeSession = {
    async execute() {
      return { revoked: true };
    },
  };
  const controller = Reflect.construct(AuthController, [
    { execute: async () => assert.fail("login must not run") },
    storage,
    { trustProxy: false },
    revokeSession,
  ]) as AuthController & {
    revokeSession(
      sessionId: string,
      response: { setHeader(name: string, value: string): void },
    ): Promise<{ readonly revoked: boolean }>;
  };
  const { headers, response } = responseHeaders();

  await storage.run(AUTHENTICATED_CONTEXT, async () => {
    assert.deepEqual(await controller.revokeSession(SESSION_ID, response), {
      revoked: true,
    });
  });

  assert.equal(headers.get("set-cookie"), serializeExpiredSessionCookie());
  assert.equal(headers.get("cache-control"), "private, no-store");
});
