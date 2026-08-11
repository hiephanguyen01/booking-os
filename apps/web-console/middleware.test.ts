import assert from "node:assert/strict";
import test from "node:test";

import { middleware } from "./middleware.ts";

const SESSION_TOKEN = `${"a".repeat(24)}.${"b".repeat(43)}`;

function assertAuthPageSecurityHeaders(response: Response): string {
  const csp = response.headers.get("content-security-policy");
  assert.ok(csp);
  assert.match(csp, /default-src 'self'/u);
  assert.match(csp, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/u);
  assert.match(csp, /style-src 'self' 'nonce-[^']+'/u);
  assert.match(csp, /object-src 'none'/u);
  assert.match(csp, /base-uri 'none'/u);
  assert.match(csp, /frame-ancestors 'none'/u);
  assert.match(csp, /form-action 'self'/u);
  assert.doesNotMatch(csp, /'unsafe-inline'/u);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(
    response.headers.get("permissions-policy"),
    "camera=(), geolocation=(), microphone=()",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  return csp;
}

test("auth pages receive a fresh nonce CSP before client hydration", async () => {
  const request = () =>
    new Request("http://localhost:3002/login", {
      headers: { host: "platform.booking.localhost:3002" },
    });

  const first = await middleware(request());
  const second = await middleware(request());

  assert.ok(first);
  assert.ok(second);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const firstCsp = assertAuthPageSecurityHeaders(first);
  const secondCsp = assertAuthPageSecurityHeaders(second);
  assert.notEqual(firstCsp, secondCsp);
});

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
