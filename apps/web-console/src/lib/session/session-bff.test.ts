import assert from "node:assert/strict";
import test from "node:test";

import {
  createSessionToken,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from "@booking-os/auth";

import { createSessionBffHandlers } from "./session-bff.js";

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

test("login performs a server-side session CSRF handshake and preserves only the secure session cookie", async () => {
  const token = createSessionToken();
  const calls: FetchCall[] = [];
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });

      if (calls.length === 1) {
        return Response.json({ csrfToken: "opaque-csrf-proof" }, { status: 200 });
      }

      return Response.json(
        {
          session: {
            id: "11111111-1111-4111-8111-111111111111",
            state: "active",
            scope: { type: "platform" },
          },
        },
        {
          status: 200,
          headers: { "set-cookie": serializeSessionCookie(token) },
        },
      );
    },
  });

  const response = await handlers.login(
    new Request("https://console.example.test/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "tracking=value; __Host-booking_session=malformed",
        origin: "https://console.example.test",
        "x-csrf-token": "attacker-proof",
        "x-forwarded-host": "attacker.example.test",
      },
      body: JSON.stringify({ email: "pilot@example.com", password: "correct password" }),
    }),
  );
  const responseText = await response.clone().text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("set-cookie"), serializeSessionCookie(token));
  assert.equal(responseText.includes(token), false);
  assert.deepEqual(await response.json(), {
    session: {
      id: "11111111-1111-4111-8111-111111111111",
      state: "active",
      scope: { type: "platform" },
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, "https://api.example.test/api/auth/session/csrf");
  assert.equal(calls[0]?.init?.cache, "no-store");
  const csrfHeaders = new Headers(calls[0]?.init?.headers);
  assert.equal(csrfHeaders.get("x-forwarded-host"), "console.example.test");

  const login = calls[1];
  assert.equal(login?.url, "https://api.example.test/api/auth/login");
  assert.equal(login?.init?.method, "POST");
  const headers = new Headers(login?.init?.headers);
  assert.equal(headers.get("origin"), "https://console.example.test");
  assert.equal(headers.get("x-csrf-token"), "opaque-csrf-proof");
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("x-forwarded-host"), "console.example.test");
  assert.deepEqual(JSON.parse(String(login?.init?.body)), {
    email: "pilot@example.com",
    password: "correct password",
  });
});

test("me forwards only the validated opaque session cookie", async () => {
  const token = createSessionToken();
  const calls: FetchCall[] = [];
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      return Response.json({ actor: { id: "user-1" }, session: { id: "session-1" } });
    },
  });

  const response = await handlers.me(
    new Request("https://console.example.test/api/auth/me", {
      headers: {
        cookie: `tracking=value; __Host-booking_session=${encodeURIComponent(token)}; theme=dark`,
        host: "console.example.test",
        origin: "https://attacker.example.test",
        "x-forwarded-host": "attacker.example.test",
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.example.test/api/auth/me");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("cookie"), `__Host-booking_session=${encodeURIComponent(token)}`);
  assert.equal(headers.get("host"), null);
  assert.equal(headers.get("origin"), null);
  assert.equal(headers.get("x-forwarded-host"), "console.example.test");
});

test("cross-origin login is rejected before contacting the session API", async () => {
  let fetchCalls = 0;
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async () => {
      fetchCalls += 1;
      return new Response(null, { status: 500 });
    },
  });

  const response = await handlers.login(
    new Request("https://console.example.test/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example.test",
      },
      body: JSON.stringify({ email: "pilot@example.com", password: "password" }),
    }),
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(fetchCalls, 0);
});

test("refresh binds session CSRF to the validated current cookie and forwards only the rotated cookie", async () => {
  const currentToken = createSessionToken();
  const successorToken = createSessionToken();
  const calls: FetchCall[] = [];
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      if (calls.length === 1) {
        return Response.json({ csrfToken: "session-proof" });
      }
      return Response.json(
        {
          session: {
            id: "11111111-1111-4111-8111-111111111111",
            state: "active",
            scope: { type: "platform" },
          },
        },
        { headers: { "set-cookie": serializeSessionCookie(successorToken) } },
      );
    },
  });

  const response = await handlers.refresh(
    new Request("https://console.example.test/api/auth/refresh", {
      method: "POST",
      headers: {
        cookie: `tracking=value; __Host-booking_session=${encodeURIComponent(currentToken)}`,
        origin: "https://console.example.test",
        "x-csrf-token": "attacker-proof",
      },
    }),
  );
  const responseText = await response.clone().text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), serializeSessionCookie(successorToken));
  assert.equal(responseText.includes(currentToken), false);
  assert.equal(responseText.includes(successorToken), false);
  assert.equal(responseText.includes("session-proof"), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, "https://api.example.test/api/auth/session/csrf");
  assert.equal(calls[1]?.url, "https://api.example.test/api/auth/session/refresh");

  const expectedCookie = `__Host-booking_session=${encodeURIComponent(currentToken)}`;
  const csrfHeaders = new Headers(calls[0]?.init?.headers);
  assert.equal(csrfHeaders.get("cookie"), expectedCookie);
  assert.equal(csrfHeaders.get("x-forwarded-host"), "console.example.test");
  const refreshHeaders = new Headers(calls[1]?.init?.headers);
  assert.equal(refreshHeaders.get("cookie"), expectedCookie);
  assert.equal(refreshHeaders.get("origin"), "https://console.example.test");
  assert.equal(refreshHeaders.get("x-csrf-token"), "session-proof");
  assert.equal(refreshHeaders.get("x-forwarded-host"), "console.example.test");
});

test("logout uses session CSRF and expires the authoritative host-only cookie", async () => {
  const token = createSessionToken();
  const calls: FetchCall[] = [];
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      if (calls.length === 1) {
        return Response.json({ csrfToken: "logout-proof" });
      }
      return Response.json(
        { loggedOut: true },
        { headers: { "set-cookie": serializeExpiredSessionCookie() } },
      );
    },
  });

  const response = await handlers.logout(
    new Request("https://console.example.test/api/auth/logout", {
      method: "POST",
      headers: {
        cookie: `__Host-booking_session=${encodeURIComponent(token)}`,
        origin: "https://console.example.test",
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), serializeExpiredSessionCookie());
  assert.deepEqual(await response.json(), { loggedOut: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, "https://api.example.test/api/auth/logout");
  const headers = new Headers(calls[1]?.init?.headers);
  assert.equal(headers.get("cookie"), `__Host-booking_session=${encodeURIComponent(token)}`);
  assert.equal(headers.get("origin"), "https://console.example.test");
  assert.equal(headers.get("x-csrf-token"), "logout-proof");
  assert.equal(headers.get("x-forwarded-host"), "console.example.test");
});
