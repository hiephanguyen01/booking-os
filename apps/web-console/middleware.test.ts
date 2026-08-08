import assert from "node:assert/strict";
import test from "node:test";

import { middleware } from "./middleware.ts";

const SESSION_TOKEN = `${"a".repeat(24)}.${"b".repeat(43)}`;

test("uses the browser Host header when Next canonicalizes the middleware URL", async (t) => {
  const originalFetch = globalThis.fetch;
  let forwardedHost: string | null = null;
  globalThis.fetch = async (_input, init) => {
    forwardedHost = new Headers(init?.headers).get("x-forwarded-host");
    return Response.json({
      session: {
        state: "active",
        scope: { type: "tenant", tenantId: "11111111-1111-4111-8111-111111111111" },
      },
    });
  };
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const response = await middleware(
    new Request("http://localhost:3002/settings/members", {
      headers: {
        host: "tenant-a.booking.localhost:3002",
        cookie: `__Host-booking_session=${SESSION_TOKEN}`,
      },
    }),
  );

  assert.equal(forwardedHost, "tenant-a.booking.localhost:3002");
  assert.equal(response, undefined);
});
