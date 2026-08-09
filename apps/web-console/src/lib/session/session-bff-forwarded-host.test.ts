import assert from "node:assert/strict";
import test from "node:test";

import { createSessionBffHandlers } from "./session-bff.js";

test("forwards the trusted browser host and origin instead of the API target", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "http://localhost:3001/api",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });

      if (calls.length === 1) {
        return Response.json({ csrfToken: "pre-auth-proof" });
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

  const response = await handlers.login(
    new Request("http://localhost:3002/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3002",
        "x-forwarded-host": "attacker.example.test",
      },
      body: JSON.stringify({
        email: "pilot@example.test",
        password: "correct-password",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);

  const csrfHeaders = new Headers(calls[0]?.init?.headers);
  assert.equal(csrfHeaders.get("x-forwarded-host"), "localhost:3002");

  const loginHeaders = new Headers(calls[1]?.init?.headers);
  assert.equal(loginHeaders.get("origin"), "http://localhost:3002");
  assert.equal(loginHeaders.get("x-forwarded-host"), "localhost:3002");
  assert.equal(loginHeaders.get("x-forwarded-host"), new URL("http://localhost:3002").host);
});

test("honors the public HTTPS origin forwarded by Caddy for login", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const handlers = createSessionBffHandlers({
    apiBaseUrl: "http://localhost:3001/api",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });

      if (calls.length === 1) {
        return Response.json({ csrfToken: "pre-auth-proof" });
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

  const response = await handlers.login(
    new Request("http://127.0.0.1:3002/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        host: "platform.booking.localhost",
        origin: "https://platform.booking.localhost",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({
        email: "pilot@example.test",
        password: "correct-password",
      }),
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(calls.length, 2);

  const csrfHeaders = new Headers(calls[0]?.init?.headers);
  assert.equal(csrfHeaders.get("x-forwarded-host"), "platform.booking.localhost");

  const loginHeaders = new Headers(calls[1]?.init?.headers);
  assert.equal(loginHeaders.get("origin"), "https://platform.booking.localhost");
  assert.equal(loginHeaders.get("x-forwarded-host"), "platform.booking.localhost");
});
