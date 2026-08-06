import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken, serializeSessionCookie } from "@booking-os/auth";

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

  const login = calls[1];
  assert.equal(login?.url, "https://api.example.test/api/auth/login");
  assert.equal(login?.init?.method, "POST");
  const headers = new Headers(login?.init?.headers);
  assert.equal(headers.get("origin"), "https://api.example.test");
  assert.equal(headers.get("x-csrf-token"), "opaque-csrf-proof");
  assert.equal(headers.get("cookie"), null);
  assert.equal(headers.get("x-forwarded-host"), null);
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
        host: "attacker.example.test",
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
  assert.equal(headers.get("x-forwarded-host"), null);
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
