import assert from "node:assert/strict";
import test from "node:test";

import { BOOKING_SESSION_COOKIE, createSessionToken } from "@booking-os/auth";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { SessionUnavailableError } from "../../domain/session-errors.js";
import { SessionAuthMiddleware } from "./session-auth.middleware.js";

const TENANT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";

function baseContext() {
  return {
    requestId: "request-1",
    traceId: "44444444-4444-4444-8444-444444444444",
    source: "console" as const,
    tenantId: TENANT_ID,
  };
}

test("hydrates authentication only from the opaque cookie and trusted tenant context", async () => {
  const token = createSessionToken();
  const calls: unknown[] = [];
  const currentSession = {
    async execute(input: unknown) {
      calls.push(input);
      return {
        actorId: USER_ID,
        sessionId: SESSION_ID,
        authScope: { type: "tenant" as const, tenantId: TENANT_ID },
        sessionState: "active" as const,
        authorizationVersion: 7,
        tokenDisposition: "active" as const,
        rotationRequired: false,
      };
    },
  };
  const storage = new RequestContextStorage();
  const middleware = new SessionAuthMiddleware(currentSession, storage, {
    trustProxy: false,
  });
  const request = {
    headers: {
      host: "alpha.example.com:443",
      cookie: `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(token)}`,
      "x-actor-id": "attacker-user",
      "x-auth-scope": "platform",
      "x-tenant-id": "99999999-9999-4999-8999-999999999999",
    },
  };
  let authenticated: unknown;

  await storage.run(baseContext(), async () => {
    await middleware.use(request, {}, (error?: unknown) => {
      assert.equal(error, undefined);
      authenticated = storage.requireAuthenticated();
    });
  });

  assert.deepEqual(calls, [
    {
      token,
      hostname: "alpha.example.com",
      scope: { type: "tenant", tenantId: TENANT_ID },
      requestId: "request-1",
    },
  ]);
  assert.deepEqual(authenticated, {
    ...baseContext(),
    actorId: USER_ID,
    sessionId: SESSION_ID,
    authScope: { type: "tenant", tenantId: TENANT_ID },
    sessionState: "active",
    authorizationVersion: 7,
  });
});

test("invalid cookies fail before downstream controllers", async () => {
  const token = createSessionToken();
  const expected = new SessionUnavailableError();
  const storage = new RequestContextStorage();
  const middleware = new SessionAuthMiddleware(
    {
      async execute() {
        throw expected;
      },
    },
    storage,
    { trustProxy: false },
  );
  let nextCalls = 0;
  let forwarded: unknown;

  await storage.run(baseContext(), async () => {
    await middleware.use(
      {
        headers: {
          host: "alpha.example.com",
          cookie: `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(token)}`,
        },
      },
      {},
      (error?: unknown) => {
        nextCalls += 1;
        forwarded = error;
      },
    );
  });

  assert.equal(nextCalls, 1);
  assert.equal(forwarded, expected);
});

test("requests without a session cookie remain anonymous for the guard to decide", async () => {
  const storage = new RequestContextStorage();
  const middleware = new SessionAuthMiddleware(
    { execute: async () => assert.fail("session validation must not run") },
    storage,
    { trustProxy: false },
  );
  let captured: unknown;

  await storage.run(baseContext(), async () => {
    await middleware.use({ headers: { host: "alpha.example.com" } }, {}, () => {
      captured = storage.require();
    });
  });

  assert.deepEqual(captured, baseContext());
});
