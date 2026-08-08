import assert from "node:assert/strict";
import test from "node:test";

import { createSessionToken } from "@booking-os/auth";

import { createMembershipBffHandlers } from "./membership-bff.js";

const API_BASE_URL = "https://api.example.test/api";
const CONSOLE_ORIGIN = "https://console.example.test";

function sessionRequest(path: string, init: RequestInit = {}): Request {
  const token = createSessionToken();
  const headers = new Headers(init.headers);
  headers.set("cookie", `tracking=value; __Host-booking_session=${encodeURIComponent(token)}`);
  headers.set("origin", CONSOLE_ORIGIN);
  return new Request(`${CONSOLE_ORIGIN}${path}`, { ...init, headers });
}

test("membership list forwards only the validated session cookie without caching", async () => {
  let captured: { url: string; init?: RequestInit } | undefined;
  const handlers = createMembershipBffHandlers({
    apiBaseUrl: API_BASE_URL,
    fetch: async (input, init) => {
      captured = { url: input.toString(), init };
      return Response.json([{ id: "member-1" }]);
    },
  });

  const response = await handlers.listMemberships(sessionRequest("/api/tenants/tenant-a/members"));

  assert.equal(response.status, 200);
  assert.equal(captured?.url, `${API_BASE_URL}/memberships`);
  assert.equal(captured?.init?.cache, "no-store");
  const headers = new Headers(captured?.init?.headers);
  assert.match(headers.get("cookie") ?? "", /^__Host-booking_session=/u);
  assert.equal(headers.get("x-forwarded-host"), "console.example.test");
});

test("membership invitation mints fresh session CSRF and strips UI-only defaults", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const handlers = createMembershipBffHandlers({
    apiBaseUrl: API_BASE_URL,
    fetch: async (input, init) => {
      calls.push({ url: input.toString(), init });
      if (calls.length === 1) return Response.json({ csrfToken: "fresh-proof" });
      return Response.json({ accepted: true }, { status: 202 });
    },
  });

  const response = await handlers.createInvitation(
    sessionRequest("/api/tenants/tenant-a/invitations", {
      method: "POST",
      body: JSON.stringify({
        email: "admin@example.test",
        role: "tenant_admin",
        expires_in_days: 7,
      }),
      headers: { "content-type": "application/json" },
    }),
  );

  assert.equal(response.status, 202);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.url, `${API_BASE_URL}/auth/session/csrf`);
  assert.equal(calls[0]?.init?.cache, "no-store");
  assert.equal(calls[1]?.url, `${API_BASE_URL}/membership/invitations`);
  assert.equal(calls[1]?.init?.cache, "no-store");
  const mutationHeaders = new Headers(calls[1]?.init?.headers);
  assert.equal(mutationHeaders.get("x-csrf-token"), "fresh-proof");
  assert.equal(calls[1]?.init?.body, JSON.stringify({ email: "admin@example.test" }));
});

test("platform tenant bootstrap forwards idempotency key and fresh CSRF", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const handlers = createMembershipBffHandlers({
    apiBaseUrl: API_BASE_URL,
    fetch: async (input, init) => {
      calls.push({ url: input.toString(), init });
      if (calls.length === 1) return Response.json({ csrfToken: "fresh-proof" });
      return Response.json({
        tenantId: "11111111-1111-4111-8111-111111111111",
        slug: "acme",
        status: "provisioning",
        ownerMembershipId: "22222222-2222-4222-8222-222222222222",
        ownerInvitationId: "33333333-3333-4333-8333-333333333333",
      });
    },
  });

  const response = await handlers.createPlatformTenant(
    sessionRequest("/api/platform/tenants", {
      method: "POST",
      body: JSON.stringify({
        slug: "acme",
        tenantName: "Acme Studio",
        ownerEmail: "owner@example.test",
      }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "bootstrap-acme-1",
      },
    }),
  );

  assert.equal(response.status, 200);
  assert.equal(calls[1]?.url, `${API_BASE_URL}/platform/tenants`);
  const headers = new Headers(calls[1]?.init?.headers);
  assert.equal(headers.get("idempotency-key"), "bootstrap-acme-1");
  assert.equal(headers.get("x-csrf-token"), "fresh-proof");
});

test("privileged membership mutation is rejected before upstream fetch without a session", async () => {
  let fetchCalls = 0;
  const handlers = createMembershipBffHandlers({
    apiBaseUrl: API_BASE_URL,
    fetch: async () => {
      fetchCalls += 1;
      return Response.json({});
    },
  });

  const response = await handlers.suspendMembership(
    new Request(`${CONSOLE_ORIGIN}/api/tenants/tenant-a/members/member-a/suspend`, {
      method: "POST",
      headers: { origin: CONSOLE_ORIGIN },
    }),
    "member-a",
  );

  assert.equal(response.status, 401);
  assert.equal(fetchCalls, 0);
});
