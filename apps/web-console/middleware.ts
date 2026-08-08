import { BOOKING_SESSION_COOKIE, readSessionToken } from "@booking-os/auth";

import { resolveAppConfig } from "./src/app-config";
import {
  type ConsoleSessionSummary,
  canAccessConsolePath,
} from "./src/lib/membership/route-access";
import { csrfOriginMismatchResponse, hasMatchingOrigin } from "./src/lib/session/csrf";

function exactSessionCookie(request: Request): string | null {
  const token = readSessionToken(request.headers.get("cookie"));
  return token === undefined ? null : `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(token)}`;
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
  const requestUrl = new URL(request.url);
  try {
    const response = await fetch(`${resolveAppConfig().apiBaseUrl}/auth/me`, {
      method: "GET",
      headers: {
        accept: "application/json",
        cookie,
        "x-forwarded-host": requestUrl.host,
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

  const session = await hydrateSession(request);
  if (session === null) return loginRedirect(request);
  if (canAccessConsolePath(pathname, session)) return undefined;
  return Response.redirect(new URL("/", request.url), 303);
}

export const config = {
  matcher: [
    "/api/:path*",
    "/app/platform/:path*",
    "/app/invite/:path*",
    "/app/tenant/:path*",
    "/app/settings/:path*",
  ],
};
