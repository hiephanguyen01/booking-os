import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken } from "@booking-os/auth";

import { createSessionBffHandlers } from "./session-bff.js";

test("session CSRF forwards only the validated opaque session cookie", async () => {
  const token = createSessionToken();
  let captured: { readonly url: string; readonly init: RequestInit | undefined } | undefined;
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async (input, init) => {
      captured = { url: typeof input === "string" ? input : input.toString(), init };
      return Response.json({ csrfToken: "session-bound-proof" });
    },
  });

  const response = await handlers.sessionCsrf(
    new Request("https://console.example.test/api/auth/session/csrf", {
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
  assert.deepEqual(await response.json(), { csrfToken: "session-bound-proof" });
  assert.equal(captured?.url, "https://api.example.test/api/auth/session/csrf");
  const headers = new Headers(captured?.init?.headers);
  assert.equal(headers.get("cookie"), `__Host-booking_session=${encodeURIComponent(token)}`);
  assert.equal(headers.get("origin"), null);
  assert.equal(headers.get("host"), null);
  assert.equal(headers.get("x-forwarded-host"), "console.example.test");
});

test("refresh overlap leaves the existing browser cookie untouched", async () => {
  const token = createSessionToken();
  let fetchCalls = 0;
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "https://api.example.test/api",
    fetch: async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return Response.json({ csrfToken: "session-bound-proof" });
      }
      return Response.json({
        session: {
          id: "11111111-1111-4111-8111-111111111111",
          state: "active",
          scope: { type: "platform" },
        },
      });
    },
  });

  const response = await handlers.refresh(
    new Request("https://console.example.test/api/auth/refresh", {
      method: "POST",
      headers: {
        cookie: `__Host-booking_session=${encodeURIComponent(token)}`,
        origin: "https://console.example.test",
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.has("set-cookie"), false);
  assert.equal(fetchCalls, 2);
});
