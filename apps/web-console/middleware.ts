import { NextResponse } from "next/server";

import { resolveAppConfig } from "./src/app-config";
import {
  type ConsoleSessionSummary,
  canAccessConsolePath,
} from "./src/lib/membership/route-access";
import { csrfOriginMismatchResponse, hasMatchingOrigin } from "./src/lib/session/csrf";
import {
  EDGE_BOOKING_SESSION_COOKIE,
  readEdgeSessionToken,
} from "./src/lib/session/edge-session-cookie";

const AUTH_PAGE_PREFIXES = ["/activate", "/password", "/invite"] as const;

function exactSessionCookie(request: Request): string | null {
  const token = readEdgeSessionToken(request.headers.get("cookie"));
  return token === undefined ? null : `${EDGE_BOOKING_SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function browserHost(request: Request): string {
  return request.headers.get("host")?.trim() || new URL(request.url).host;
}

function isAuthPage(pathname: string): boolean {
  if (pathname === "/login") return true;
  return AUTH_PAGE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function authPageContentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

function authPageResponse(request: Request): Response {
  const nonce = globalThis.crypto.randomUUID().replaceAll("-", "");
  const contentSecurityPolicy = authPageContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("content-security-policy", contentSecurityPolicy);
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("permissions-policy", "camera=(), geolocation=(), microphone=()");
  response.headers.set("cache-control", "no-store");
  return response;
}

function readSessionSummary(payload: unknown): ConsoleSessionSummary | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const session = (payload as Record<string, unknown>).session;
  if (typeof session !== "object" || session === null || Array.isArray(session)) return null;
  const state = (session as Record<string, unknown>).state;
  const scope = (session as Record<string, unknown>).scope;
  if (
    typeof state !== "string" ||
    typeof scope !== "object" ||
    scope === null ||
    Array.isArray(scope)
  ) {
    return null;
  }

  const scopeType = (scope as Record<string, unknown>).type;
  if (scopeType === "platform") return { state, scope: { type: "platform" } };
  if (scopeType === "tenant") {
    const tenantId = (scope as Record<string, unknown>).tenantId;
    return {
      state,
      scope: {
        type: "tenant",
        ...(typeof tenantId === "string" ? { tenantId } : {}),
      },
    };
  }
  return null;
}

async function hydrateSession(request: Request): Promise<ConsoleSessionSummary | null> {
  const cookie = exactSessionCookie(request);
  if (cookie === null) return null;
  try {
    const response = await fetch(`${resolveAppConfig().apiBaseUrl}/auth/me`, {
      method: "GET",
      headers: {
        accept: "application/json",
        cookie,
        "x-forwarded-host": browserHost(request),
      },
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) return null;
    return readSessionSummary(await response.json());
  } catch {
    return null;
  }
}

function loginRedirect(request: Request): Response {
  const requestUrl = new URL(request.url);
  const target = new URL("/login", requestUrl.origin);
  target.searchParams.set("next", `${requestUrl.pathname}${requestUrl.search}`);
  return Response.redirect(target, 307);
}

export async function middleware(request: Request): Promise<Response | undefined> {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/")) {
    return hasMatchingOrigin(request) ? undefined : csrfOriginMismatchResponse();
  }
  if (isAuthPage(pathname)) return authPageResponse(request);

  const session = await hydrateSession(request);
  if (session === null) return loginRedirect(request);
  if (canAccessConsolePath(pathname, session)) return undefined;
  return Response.redirect(new URL("/", request.url), 303);
}

export const config = {
  matcher: [
    "/api/:path*",
    "/login",
    "/activate/:path*",
    "/password/:path*",
    "/invite/:path*",
    "/platform/:path*",
    "/tenant/:path*",
    "/settings/:path*",
  ],
};
