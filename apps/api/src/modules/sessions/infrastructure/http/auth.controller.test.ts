import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionToken,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from "@booking-os/auth";
import { UnauthorizedException } from "@nestjs/common";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import type { StoredSession } from "../../application/ports/session-repository.port.js";
import { InvalidLoginError } from "../../application/use-cases/login.use-case.js";
import { AuthController } from "./auth.controller.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const TENANT_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-08-06T08:00:00.000Z");

const BASE_CONTEXT = Object.freeze({
  requestId: "request-1",
  traceId: "44444444-4444-4444-8444-444444444444",
  source: "console" as const,
});

const AUTHENTICATED_CONTEXT = Object.freeze({
  ...BASE_CONTEXT,
  actorId: USER_ID,
  sessionId: SESSION_ID,
  authScope: { type: "platform" as const },
  sessionState: "active" as const,
});

function storedSession(scope: StoredSession["scope"]): StoredSession {
  return {
    id: SESSION_ID,
    userId: USER_ID,
    scope,
    hostname: "console.example.com",
    state: "active",
    authorizationVersion: 3,
    version: 1,
    idleExpiresAt: new Date("2026-08-13T08:00:00.000Z"),
    absoluteExpiresAt: new Date("2026-09-05T08:00:00.000Z"),
    lastSeenAt: NOW,
    revokedAt: null,
    revocationReason: null,
    compromisedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

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

test("logs in with trusted host, IP, and tenant context while returning only public state", async () => {
  const storage = new RequestContextStorage();
  const token = createSessionToken();
  const calls: unknown[] = [];
  const login = {
    async execute(input: unknown) {
      calls.push(input);
      return {
        token,
        session: storedSession({ type: "tenant", tenantId: TENANT_ID }),
      };
    },
  };
  const controller = new AuthController(login, storage, { trustProxy: false });
  const { headers, response } = responseHeaders();

  await storage.run({ ...BASE_CONTEXT, tenantId: TENANT_ID }, async () => {
    const result = await controller.login(
      {
        email: " owner@example.com ",
        password: "correct horse battery staple",
        tenantId: "99999999-9999-4999-8999-999999999999",
      },
      {
        ip: "203.0.113.44",
        headers: {
          host: "console.example.com:443",
          "x-tenant-id": "99999999-9999-4999-8999-999999999999",
        },
      },
      response,
    );

    assert.deepEqual(calls, [
      {
        email: " owner@example.com ",
        password: "correct horse battery staple",
        ipAddress: "203.0.113.44",
        hostname: "console.example.com",
        scope: { type: "tenant", tenantId: TENANT_ID },
        requestId: "request-1",
      },
    ]);
    assert.equal(headers.get("set-cookie"), serializeSessionCookie(token));
    assert.equal(headers.get("cache-control"), "private, no-store");
    assert.deepEqual(result, {
      session: {
        id: SESSION_ID,
        state: "active",
        scope: { type: "tenant", tenantId: TENANT_ID },
      },
    });
    assert.equal(JSON.stringify(result).includes(token), false);
  });
});

test("maps every invalid login to one generic 401 without setting a cookie", async () => {
  const storage = new RequestContextStorage();
  const controller = new AuthController(
    {
      async execute() {
        throw new InvalidLoginError();
      },
    },
    storage,
    { trustProxy: false },
  );
  const { headers, response } = responseHeaders();

  await storage.run(BASE_CONTEXT, async () => {
    await assert.rejects(
      controller.login(
        { email: "unknown@example.com", password: "wrong" },
        { ip: "203.0.113.44", headers: { host: "console.example.com" } },
        response,
      ),
      (error: unknown) =>
        error instanceof UnauthorizedException && error.message === "Invalid email or password.",
    );
  });

  assert.equal(headers.has("set-cookie"), false);
  assert.equal(headers.get("cache-control"), "private, no-store");
});

test("logs out idempotently, revokes the current session, and expires the host cookie", async () => {
  const storage = new RequestContextStorage();
  const calls: unknown[] = [];
  const revoke = {
    async execute(input: unknown) {
      calls.push(input);
      return { revoked: false };
    },
  };
  const controller = Reflect.construct(AuthController, [
    { execute: async () => assert.fail("login must not run") },
    storage,
    { trustProxy: false },
    revoke,
  ]) as AuthController & {
    logout(response: { setHeader(name: string, value: string): void }): Promise<{
      readonly loggedOut: true;
    }>;
  };
  const { headers, response } = responseHeaders();

  await storage.run(AUTHENTICATED_CONTEXT, async () => {
    assert.deepEqual(await controller.logout(response), { loggedOut: true });
  });

  assert.deepEqual(calls, [
    {
      sessionId: SESSION_ID,
      userId: USER_ID,
      reason: "logout",
      requestId: "request-1",
    },
  ]);
  assert.equal(headers.get("set-cookie"), serializeExpiredSessionCookie());
  assert.equal(headers.get("cache-control"), "private, no-store");
});

test("returns only trusted current authentication state with private no-store", () => {
  const storage = new RequestContextStorage();
  const controller = new AuthController(
    { execute: async () => assert.fail("login must not run") },
    storage,
    { trustProxy: false },
  ) as AuthController & {
    me(response: { setHeader(name: string, value: string): void }): {
      readonly actor: { readonly id: string };
      readonly session: {
        readonly id: string;
        readonly state: "active" | "invitation_pending";
        readonly scope:
          | { readonly type: "platform" }
          | { readonly type: "tenant"; tenantId: string };
      };
    };
  };
  const { headers, response } = responseHeaders();

  storage.run(AUTHENTICATED_CONTEXT, () => {
    assert.deepEqual(controller.me(response), {
      actor: { id: USER_ID },
      session: {
        id: SESSION_ID,
        state: "active",
        scope: { type: "platform" },
      },
    });
  });

  assert.equal(headers.get("cache-control"), "private, no-store");
  assert.equal(headers.has("set-cookie"), false);
});
