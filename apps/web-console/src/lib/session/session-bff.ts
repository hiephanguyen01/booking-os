import {
  BOOKING_SESSION_COOKIE,
  readSessionToken,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from "@booking-os/auth";

export interface SessionBffDependencies {
  readonly apiBaseUrl: string;
  readonly fetch: typeof fetch;
}

export interface SessionBffHandlers {
  readonly sessionCsrf: (request: Request) => Promise<Response>;
  readonly login: (request: Request) => Promise<Response>;
  readonly logout: (request: Request) => Promise<Response>;
  readonly refresh: (request: Request) => Promise<Response>;
  readonly me: (request: Request) => Promise<Response>;
  readonly sessions: (request: Request) => Promise<Response>;
  readonly revokeSession: (request: Request, sessionId: string) => Promise<Response>;
  readonly revokeOtherSessions: (request: Request) => Promise<Response>;
}

interface LoginBody {
  readonly email: string;
  readonly password: string;
}

interface AuthenticatedMutationOptions {
  readonly method: "DELETE" | "POST";
  readonly path: string;
  readonly allowSessionCookie: boolean;
}

interface SessionApiTarget {
  readonly baseUrl: string;
}

interface TrustedBrowserTarget {
  readonly origin: string;
  readonly host: string;
}

const SAFE_RESPONSE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
});

const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function normalizeSessionApiTarget(value: string): SessionApiTarget {
  const url = new URL(value);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  const allowedProtocol = url.protocol === "https:" || (url.protocol === "http:" && loopback);

  if (
    !allowedProtocol ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Session API base URL must be a canonical HTTPS URL or loopback HTTP URL.");
  }

  const pathname = url.pathname.replace(/\/+$/u, "");
  return Object.freeze({
    baseUrl: `${url.origin}${pathname}`,
  });
}

function trustedBrowserTarget(request: Request): TrustedBrowserTarget {
  const url = new URL(request.url);
  return Object.freeze({
    origin: url.origin,
    host: url.host,
  });
}

function apiEndpoint(apiBaseUrl: string, path: string): string {
  return `${apiBaseUrl}${path}`;
}

function jsonError(status: number, message: string): Response {
  return Response.json(
    { error: message },
    {
      status,
      headers: SAFE_RESPONSE_HEADERS,
    },
  );
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === trustedBrowserTarget(request).origin;
}

async function readLoginBody(request: Request): Promise<LoginBody | null> {
  try {
    const value: unknown = await request.json();
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }

    const candidate = value as Record<string, unknown>;
    if (typeof candidate.email !== "string" || typeof candidate.password !== "string") {
      return null;
    }

    return {
      email: candidate.email,
      password: candidate.password,
    };
  } catch {
    return null;
  }
}

function readCsrfToken(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }

  const csrfToken = (payload as Record<string, unknown>).csrfToken;
  return typeof csrfToken === "string" && csrfToken !== "" ? csrfToken : null;
}

function exactSessionCookie(cookieHeader: string | null): string | null {
  const token = readSessionToken(cookieHeader);
  return token === undefined ? null : `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function sanitizedSetCookie(setCookie: string | null): string | null {
  if (setCookie === null) {
    return null;
  }

  const [pair, ...attributes] = setCookie.split(";").map((part) => part.trim());
  const separator = pair?.indexOf("=") ?? -1;
  if (separator <= 0 || pair?.slice(0, separator) !== BOOKING_SESSION_COOKIE) {
    return null;
  }

  const encodedValue = pair.slice(separator + 1);
  if (encodedValue === "") {
    const expires = attributes.some((attribute) => attribute.toLowerCase() === "max-age=0");
    return expires ? serializeExpiredSessionCookie() : null;
  }

  const token = readSessionToken(`${BOOKING_SESSION_COOKIE}=${encodedValue}`);
  return token === undefined ? null : serializeSessionCookie(token);
}

async function forwardResponse(
  upstream: Response,
  options: { readonly allowSessionCookie: boolean },
): Promise<Response> {
  const headers = new Headers(SAFE_RESPONSE_HEADERS);
  const contentType = upstream.headers.get("content-type");
  if (contentType !== null) {
    headers.set("content-type", contentType);
  }

  if (options.allowSessionCookie) {
    const setCookie = sanitizedSetCookie(upstream.headers.get("set-cookie"));
    if (setCookie !== null) {
      headers.set("set-cookie", setCookie);
    }
  }

  const body = await upstream.text();
  return new Response(body === "" ? null : body, {
    status: upstream.status,
    headers,
  });
}

export function createSessionBffHandlers(dependencies: SessionBffDependencies): SessionBffHandlers {
  const apiTarget = normalizeSessionApiTarget(dependencies.apiBaseUrl);

  async function fetchSessionCsrf(request: Request, cookie: string | null): Promise<Response> {
    const browserTarget = trustedBrowserTarget(request);
    const headers = new Headers({
      accept: "application/json",
      "x-forwarded-host": browserTarget.host,
    });
    if (cookie !== null) {
      headers.set("cookie", cookie);
    }

    return dependencies.fetch(apiEndpoint(apiTarget.baseUrl, "/auth/session/csrf"), {
      method: "GET",
      headers,
      cache: "no-store",
      redirect: "error",
    });
  }

  async function authenticatedMutation(
    request: Request,
    options: AuthenticatedMutationOptions,
  ): Promise<Response> {
    if (!isSameOrigin(request)) {
      return jsonError(403, "Request origin is not allowed.");
    }

    const browserTarget = trustedBrowserTarget(request);
    const cookie = exactSessionCookie(request.headers.get("cookie"));
    if (cookie === null) {
      return jsonError(401, "Authentication is required.");
    }

    try {
      const csrfResponse = await fetchSessionCsrf(request, cookie);
      if (!csrfResponse.ok) {
        return jsonError(503, "Session service is unavailable.");
      }

      const csrfToken = readCsrfToken(await csrfResponse.json());
      if (csrfToken === null) {
        return jsonError(503, "Session service is unavailable.");
      }

      const upstream = await dependencies.fetch(apiEndpoint(apiTarget.baseUrl, options.path), {
        method: options.method,
        headers: {
          accept: "application/json",
          cookie,
          origin: browserTarget.origin,
          "x-csrf-token": csrfToken,
          "x-forwarded-host": browserTarget.host,
        },
        cache: "no-store",
        redirect: "error",
      });

      return forwardResponse(upstream, {
        allowSessionCookie: options.allowSessionCookie,
      });
    } catch {
      return jsonError(503, "Session service is unavailable.");
    }
  }

  return {
    async sessionCsrf(request) {
      const cookie = exactSessionCookie(request.headers.get("cookie"));
      if (cookie === null) {
        return jsonError(401, "Authentication is required.");
      }

      try {
        const upstream = await fetchSessionCsrf(request, cookie);
        return forwardResponse(upstream, { allowSessionCookie: false });
      } catch {
        return jsonError(503, "Session service is unavailable.");
      }
    },
    async login(request) {
      if (!isSameOrigin(request)) {
        return jsonError(403, "Request origin is not allowed.");
      }

      const browserTarget = trustedBrowserTarget(request);
      const body = await readLoginBody(request);
      if (body === null) {
        return jsonError(400, "Invalid authentication request.");
      }

      try {
        const csrfResponse = await fetchSessionCsrf(request, null);
        if (!csrfResponse.ok) {
          return jsonError(503, "Session service is unavailable.");
        }

        const csrfToken = readCsrfToken(await csrfResponse.json());
        if (csrfToken === null) {
          return jsonError(503, "Session service is unavailable.");
        }

        const upstream = await dependencies.fetch(apiEndpoint(apiTarget.baseUrl, "/auth/login"), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            origin: browserTarget.origin,
            "x-csrf-token": csrfToken,
            "x-forwarded-host": browserTarget.host,
          },
          body: JSON.stringify(body),
          cache: "no-store",
          redirect: "error",
        });

        return forwardResponse(upstream, { allowSessionCookie: true });
      } catch {
        return jsonError(503, "Session service is unavailable.");
      }
    },
    logout: (request) =>
      authenticatedMutation(request, {
        method: "POST",
        path: "/auth/logout",
        allowSessionCookie: true,
      }),
    refresh: (request) =>
      authenticatedMutation(request, {
        method: "POST",
        path: "/auth/session/refresh",
        allowSessionCookie: true,
      }),
    async me(request) {
      const browserTarget = trustedBrowserTarget(request);
      const cookie = exactSessionCookie(request.headers.get("cookie"));
      const headers = new Headers({
        accept: "application/json",
        "x-forwarded-host": browserTarget.host,
      });
      if (cookie !== null) {
        headers.set("cookie", cookie);
      }

      try {
        const upstream = await dependencies.fetch(apiEndpoint(apiTarget.baseUrl, "/auth/me"), {
          method: "GET",
          headers,
          cache: "no-store",
          redirect: "error",
        });
        return forwardResponse(upstream, { allowSessionCookie: false });
      } catch {
        return jsonError(503, "Session service is unavailable.");
      }
    },
    async sessions(request) {
      const browserTarget = trustedBrowserTarget(request);
      const cookie = exactSessionCookie(request.headers.get("cookie"));
      if (cookie === null) {
        return jsonError(401, "Authentication is required.");
      }

      try {
        const upstream = await dependencies.fetch(
          apiEndpoint(apiTarget.baseUrl, "/auth/sessions"),
          {
            method: "GET",
            headers: {
              accept: "application/json",
              cookie,
              "x-forwarded-host": browserTarget.host,
            },
            cache: "no-store",
            redirect: "error",
          },
        );
        return forwardResponse(upstream, { allowSessionCookie: false });
      } catch {
        return jsonError(503, "Session service is unavailable.");
      }
    },
    async revokeSession(request, sessionId) {
      if (!SESSION_ID_PATTERN.test(sessionId)) {
        return jsonError(400, "Invalid session identifier.");
      }

      return authenticatedMutation(request, {
        method: "DELETE",
        path: `/auth/sessions/${sessionId}`,
        allowSessionCookie: true,
      });
    },
    revokeOtherSessions: (request) =>
      authenticatedMutation(request, {
        method: "POST",
        path: "/auth/sessions/revoke-others",
        allowSessionCookie: false,
      }),
  };
}
