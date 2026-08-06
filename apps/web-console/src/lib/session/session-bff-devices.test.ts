import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken, serializeExpiredSessionCookie } from "@booking-os/auth";

import { createSessionBffHandlers } from "./session-bff.js";

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

test("session list forwards only the validated opaque session cookie", async () => {
  const token = createSessionToken();
  const calls: FetchCall[] = [];
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async (input, init) => {
      calls.push({ url: typeof input === "string" ? input : input.toString(), init });
      return Response.json({ sessions: [{ id: SESSION_ID, current: true }] });
    },
  });

  const response = await handlers.sessions(
    new Request("https://console.example.test/api/auth/sessions", {
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
  assert.deepEqual(await response.json(), { sessions: [{ id: SESSION_ID, current: true }] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.example.test/api/auth/sessions");
  assert.equal(calls[0]?.init?.method, "GET");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.get("cookie"), `__Host-booking_session=${encodeURIComponent(token)}`);
  assert.equal(headers.get("origin"), null);
  assert.equal(headers.get("host"), null);
  assert.equal(headers.get("x-forwarded-host"), null);
});

test("revoking a device uses authenticated CSRF and preserves a current-device expiry", async () => {
  const token = createSessionToken();
  const calls: FetchCall[] = [];
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async (input, init) => {
      calls.push({ url: typeof input === "string" ? input : input.toString(), init });
      if (calls.length === 1) {
        return Response.json({ csrfToken: "device-proof" });
      }
      return Response.json(
        { revoked: true },
        { headers: { "set-cookie": serializeExpiredSessionCookie() } },
      );
    },
  });

  const response = await handlers.revokeSession(
    new Request(`https://console.example.test/api/auth/sessions/${SESSION_ID}`, {
      method: "DELETE",
      headers: {
        cookie: `tracking=value; __Host-booking_session=${encodeURIComponent(token)}`,
        origin: "https://console.example.test",
        "x-csrf-token": "attacker-proof",
      },
    }),
    SESSION_ID,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("set-cookie"), serializeExpiredSessionCookie());
  assert.deepEqual(await response.json(), { revoked: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, "https://api.example.test/api/auth/session/csrf");
  assert.equal(calls[1]?.url, `https://api.example.test/api/auth/sessions/${SESSION_ID}`);
  assert.equal(calls[1]?.init?.method, "DELETE");
  const headers = new Headers(calls[1]?.init?.headers);
  assert.equal(headers.get("cookie"), `__Host-booking_session=${encodeURIComponent(token)}`);
  assert.equal(headers.get("origin"), "https://api.example.test");
  assert.equal(headers.get("x-csrf-token"), "device-proof");
});

test("revoke-others uses authenticated CSRF without exposing the proof", async () => {
  const token = createSessionToken();
  const calls: FetchCall[] = [];
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async (input, init) => {
      calls.push({ url: typeof input === "string" ? input : input.toString(), init });
      if (calls.length === 1) {
        return Response.json({ csrfToken: "others-proof" });
      }
      return Response.json({ revokedCount: 3 });
    },
  });

  const response = await handlers.revokeOtherSessions(
    new Request("https://console.example.test/api/auth/sessions/revoke-others", {
      method: "POST",
      headers: {
        cookie: `__Host-booking_session=${encodeURIComponent(token)}`,
        origin: "https://console.example.test",
      },
    }),
  );
  const responseText = await response.clone().text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(responseText.includes("others-proof"), false);
  assert.deepEqual(await response.json(), { revokedCount: 3 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.url, "https://api.example.test/api/auth/sessions/revoke-others");
  assert.equal(calls[1]?.init?.method, "POST");
});

test("device revocation rejects a non-UUID path before contacting the API", async () => {
  let fetchCalls = 0;
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async () => {
      fetchCalls += 1;
      return new Response(null, { status: 500 });
    },
  });

  const response = await handlers.revokeSession(
    new Request("https://console.example.test/api/auth/sessions/..%2F..%2Fhealth", {
      method: "DELETE",
      headers: {
        cookie: `__Host-booking_session=${encodeURIComponent(createSessionToken())}`,
        origin: "https://console.example.test",
      },
    }),
    "../../health",
  );

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(fetchCalls, 0);
});
