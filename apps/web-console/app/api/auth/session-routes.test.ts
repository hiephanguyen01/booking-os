import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

import {
  createSessionToken,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from "@booking-os/auth";

interface FetchCall {
  readonly method: string;
  readonly url: string;
}

interface SimpleRouteModule {
  readonly GET?: (request: Request) => Promise<Response>;
  readonly POST?: (request: Request) => Promise<Response>;
  readonly DELETE?: (
    request: Request,
    context: { readonly params: Promise<{ readonly sessionId: string }> },
  ) => Promise<Response>;
}

const API_BASE_URL = "https://api.example.test/api";
const CONSOLE_ORIGIN = "https://console.example.test";
const SESSION_ID = "11111111-1111-4111-8111-111111111111";

async function loadRoute(relativePath: string): Promise<SimpleRouteModule> {
  return import(new URL(relativePath, import.meta.url).href) as Promise<SimpleRouteModule>;
}

function request(
  path: string,
  options: { readonly method?: string; readonly cookie?: string; readonly body?: unknown } = {},
): Request {
  const headers = new Headers();
  if (options.cookie) {
    headers.set("cookie", options.cookie);
  }
  if (options.method && options.method !== "GET") {
    headers.set("origin", CONSOLE_ORIGIN);
  }
  if (options.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  const init: RequestInit = {
    method: options.method ?? "GET",
    headers,
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
  }

  return new Request(`${CONSOLE_ORIGIN}${path}`, init);
}

test("sample and in-memory session authority files are removed", async () => {
  const obsoleteFiles = [
    "../session/route.ts",
    "../session/route.test.ts",
    "../../../src/lib/session/session-route-handlers.ts",
    "../../../src/lib/session/session-store.ts",
  ];

  for (const obsoleteFile of obsoleteFiles) {
    await assert.rejects(access(new URL(obsoleteFile, import.meta.url)));
  }
});

test("App Router exposes the complete same-origin session BFF surface", async () => {
  const originalApiBaseUrl = process.env.API_BASE_URL;
  const originalFetch = globalThis.fetch;
  const currentToken = createSessionToken();
  const successorToken = createSessionToken();
  const cookie = `__Host-booking_session=${encodeURIComponent(currentToken)}`;
  const calls: FetchCall[] = [];

  process.env.API_BASE_URL = API_BASE_URL;
  globalThis.fetch = (async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    const pathname = new URL(url).pathname;

    if (pathname === "/api/auth/session/csrf") {
      return Response.json({ csrfToken: "session-proof" });
    }
    if (pathname === "/api/auth/login") {
      return Response.json(
        { session: { id: SESSION_ID, state: "active", scope: { type: "platform" } } },
        { headers: { "set-cookie": serializeSessionCookie(successorToken) } },
      );
    }
    if (pathname === "/api/auth/logout") {
      return Response.json(
        { loggedOut: true },
        { headers: { "set-cookie": serializeExpiredSessionCookie() } },
      );
    }
    if (pathname === "/api/auth/session/refresh") {
      return Response.json(
        { session: { id: SESSION_ID, state: "active", scope: { type: "platform" } } },
        { headers: { "set-cookie": serializeSessionCookie(successorToken) } },
      );
    }
    if (pathname === "/api/auth/me") {
      return Response.json({ actor: { id: "actor-1" }, session: { id: SESSION_ID } });
    }
    if (pathname === "/api/auth/sessions" && method === "GET") {
      return Response.json({ sessions: [{ id: SESSION_ID, current: true }] });
    }
    if (pathname === `/api/auth/sessions/${SESSION_ID}` && method === "DELETE") {
      return Response.json(
        { revoked: true },
        { headers: { "set-cookie": serializeExpiredSessionCookie() } },
      );
    }
    if (pathname === "/api/auth/sessions/revoke-others" && method === "POST") {
      return Response.json({ revokedCount: 2 });
    }

    return Response.json({ error: "unexpected upstream request" }, { status: 500 });
  }) as typeof fetch;

  try {
    const [login, logout, csrf, refresh, me, sessions, revokeSession, revokeOthers] =
      await Promise.all([
        loadRoute("./login/route.ts"),
        loadRoute("./logout/route.ts"),
        loadRoute("./session/csrf/route.ts"),
        loadRoute("./session/refresh/route.ts"),
        loadRoute("./me/route.ts"),
        loadRoute("./sessions/route.ts"),
        loadRoute("./sessions/[sessionId]/route.ts"),
        loadRoute("./sessions/revoke-others/route.ts"),
      ]);

    assert.equal(typeof login.POST, "function");
    assert.equal(typeof logout.POST, "function");
    assert.equal(typeof csrf.GET, "function");
    assert.equal(typeof refresh.POST, "function");
    assert.equal(typeof me.GET, "function");
    assert.equal(typeof sessions.GET, "function");
    assert.equal(typeof revokeSession.DELETE, "function");
    assert.equal(typeof revokeOthers.POST, "function");

    const responses = await Promise.all([
      login.POST?.(
        request("/api/auth/login", {
          method: "POST",
          body: { email: "pilot@example.com", password: "correct password" },
        }),
      ),
      logout.POST?.(request("/api/auth/logout", { method: "POST", cookie })),
      csrf.GET?.(request("/api/auth/session/csrf", { cookie })),
      refresh.POST?.(request("/api/auth/session/refresh", { method: "POST", cookie })),
      me.GET?.(request("/api/auth/me", { cookie })),
      sessions.GET?.(request("/api/auth/sessions", { cookie })),
      revokeSession.DELETE?.(
        request(`/api/auth/sessions/${SESSION_ID}`, { method: "DELETE", cookie }),
        {
          params: Promise.resolve({ sessionId: SESSION_ID }),
        },
      ),
      revokeOthers.POST?.(request("/api/auth/sessions/revoke-others", { method: "POST", cookie })),
    ]);

    assert.equal(
      responses.every((response) => response?.status === 200),
      true,
    );
    assert.equal(
      calls.some((call) => call.url === `${API_BASE_URL}/auth/login` && call.method === "POST"),
      true,
    );
    assert.equal(
      calls.some(
        (call) =>
          call.url === `${API_BASE_URL}/auth/sessions/${SESSION_ID}` && call.method === "DELETE",
      ),
      true,
    );
    assert.equal(
      calls.some(
        (call) =>
          call.url === `${API_BASE_URL}/auth/sessions/revoke-others` && call.method === "POST",
      ),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiBaseUrl === undefined) {
      delete process.env.API_BASE_URL;
    } else {
      process.env.API_BASE_URL = originalApiBaseUrl;
    }
  }
});
