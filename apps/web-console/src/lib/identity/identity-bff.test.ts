import assert from "node:assert/strict";
import test from "node:test";

import { createIdentityBffHandlers } from "./identity-bff.js";

interface FetchCall {
  readonly url: string;
  readonly init?: RequestInit;
}

test("password-forgot performs a server-side CSRF handshake and returns only a neutral response", async () => {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });

    if (calls.length === 1) {
      return new Response(JSON.stringify({ csrfToken: "opaque-proof" }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie":
            "__Host-booking_pre_auth_csrf=opaque-nonce; Path=/; Max-Age=900; HttpOnly; Secure; SameSite=Strict",
        },
      });
    }

    return new Response(JSON.stringify({ accepted: true }), {
      status: 202,
      headers: { "content-type": "application/json" },
    });
  };
  const handlers = createIdentityBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: fetchImpl,
  });
  const response = await handlers.passwordForgot(
    new Request("https://console.example.test/api/auth/password/forgot", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://console.example.test",
      },
      body: JSON.stringify({ email: "pilot@example.com" }),
    }),
  );

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(JSON.stringify(await response.clone().text()).includes("opaque-proof"), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, "https://api.example.test/api/auth/csrf?purpose=password_forgot");
  assert.equal(calls[0]?.init?.cache, "no-store");

  const post = calls[1];
  assert.equal(post?.url, "https://api.example.test/api/auth/password/forgot");
  const headers = new Headers(post?.init?.headers);
  assert.equal(headers.get("cookie"), "__Host-booking_pre_auth_csrf=opaque-nonce");
  assert.equal(headers.get("x-csrf-token"), "opaque-proof");
  assert.equal(headers.get("origin"), "https://api.example.test");
  assert.deepEqual(JSON.parse(String(post?.init?.body)), { email: "pilot@example.com" });
});

test("cross-origin requests are rejected before contacting the identity API", async () => {
  let fetchCalls = 0;
  const handlers = createIdentityBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async () => {
      fetchCalls += 1;
      return new Response(null, { status: 500 });
    },
  });

  const response = await handlers.passwordForgot(
    new Request("https://console.example.test/api/auth/password/forgot", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://attacker.example.test",
      },
      body: JSON.stringify({ email: "pilot@example.com" }),
    }),
  );

  assert.equal(response.status, 403);
  assert.equal(fetchCalls, 0);
});
