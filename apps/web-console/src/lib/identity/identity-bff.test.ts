import assert from "node:assert/strict";
import test from "node:test";

import { createIdentityBffHandlers } from "./identity-bff.js";

interface FetchCall {
  readonly url: string;
  readonly init: RequestInit | undefined;
}

function createIdentityFetch(calls: FetchCall[], finalStatus: number): typeof fetch {
  return async (input, init) => {
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

    return new Response(
      JSON.stringify(finalStatus === 202 ? { accepted: true } : { completed: true }),
      {
        status: finalStatus,
        headers: { "content-type": "application/json" },
      },
    );
  };
}

test("password-forgot performs a server-side CSRF handshake and returns only a neutral response", async () => {
  const calls: FetchCall[] = [];
  const handlers = createIdentityBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: createIdentityFetch(calls, 202),
  });
  const response = await handlers.passwordForgot(
    new Request("https://console.example.test/api/auth/password/forgot", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://console.example.test",
      },
      body: JSON.stringify({ email: "pilot@example.com", scopeType: "platform" }),
    }),
  );
  const responseText = await response.clone().text();

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { accepted: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(responseText.includes("opaque-proof"), false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, "https://api.example.test/api/auth/csrf?purpose=password_forgot");
  assert.equal(calls[0]?.init?.cache, "no-store");

  const post = calls[1];
  assert.equal(post?.url, "https://api.example.test/api/auth/password/forgot");
  const headers = new Headers(post?.init?.headers);
  assert.equal(headers.get("cookie"), "__Host-booking_pre_auth_csrf=opaque-nonce");
  assert.equal(headers.get("x-csrf-token"), "opaque-proof");
  assert.equal(headers.get("origin"), "https://api.example.test");
  assert.deepEqual(JSON.parse(String(post?.init?.body)), {
    email: "pilot@example.com",
    scopeType: "platform",
  });
});

test("activation consumes the token only on the server-side API call", async () => {
  const calls: FetchCall[] = [];
  const handlers = createIdentityBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: createIdentityFetch(calls, 200),
  });
  const response = await handlers.activationComplete(
    new Request("https://platform.booking.localhost/api/auth/activation/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://platform.booking.localhost",
      },
      body: JSON.stringify({
        token: "selector.secret",
        newPassword: "correct horse battery staple",
        scopeType: "platform",
      }),
    }),
  );
  const responseText = await response.clone().text();

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { completed: true });
  assert.doesNotMatch(responseText, /selector|secret|opaque-proof|opaque-nonce/iu);
  assert.equal(calls[0]?.url, "https://api.example.test/api/auth/csrf?purpose=activation");
  assert.equal(calls[1]?.url, "https://api.example.test/api/auth/activation/complete");
  assert.equal(
    new Headers(calls[0]?.init?.headers).get("x-forwarded-host"),
    "platform.booking.localhost",
  );
  assert.equal(
    new Headers(calls[1]?.init?.headers).get("x-forwarded-host"),
    "platform.booking.localhost",
  );
  assert.equal(new Headers(calls[1]?.init?.headers).get("origin"), "https://api.example.test");
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    token: "selector.secret",
    newPassword: "correct horse battery staple",
    scopeType: "platform",
  });
});

test("password reset uses its own CSRF purpose and neutral completion response", async () => {
  const calls: FetchCall[] = [];
  const handlers = createIdentityBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: createIdentityFetch(calls, 200),
  });
  const response = await handlers.passwordReset(
    new Request("https://console.example.test/api/auth/password/reset", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://console.example.test",
      },
      body: JSON.stringify({
        token: "selector.secret",
        newPassword: "correct horse battery staple",
        scopeType: "tenant",
        tenantId: "11111111-1111-4111-8111-111111111111",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { completed: true });
  assert.equal(calls[0]?.url, "https://api.example.test/api/auth/csrf?purpose=password_reset");
  assert.equal(calls[1]?.url, "https://api.example.test/api/auth/password/reset");
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

  for (const handler of [
    handlers.passwordForgot,
    handlers.activationComplete,
    handlers.passwordReset,
  ]) {
    const response = await handler(
      new Request("https://console.example.test/api/auth/identity", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.example.test",
        },
        body: JSON.stringify({ token: "selector.secret" }),
      }),
    );
    assert.equal(response.status, 403);
  }

  assert.equal(fetchCalls, 0);
});
