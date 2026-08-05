const PRE_AUTH_CSRF_COOKIE_NAME = "__Host-booking_pre_auth_csrf";

export interface IdentityBffOptions {
  readonly apiBaseUrl: string;
  readonly fetch?: typeof fetch;
}

export interface IdentityBffHandlers {
  passwordForgot(request: Request): Promise<Response>;
}

interface CsrfResponseBody {
  readonly csrfToken: string;
}

function securityHeaders(): Headers {
  return new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: securityHeaders(),
  });
}

function hasMatchingOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }

  try {
    return new URL(origin).origin === new URL(request.url).origin && origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function resolveApiBaseUrl(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new TypeError("Identity API base URL must use HTTP or HTTPS.");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url;
}

function endpoint(base: URL, path: string): string {
  const url = new URL(base.toString());
  url.pathname = `${base.pathname}${path}`;
  return url.toString();
}

function parseCsrfBody(value: unknown): CsrfResponseBody | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const csrfToken = (value as { csrfToken?: unknown }).csrfToken;
  return typeof csrfToken === "string" && csrfToken.length > 0 ? { csrfToken } : null;
}

function extractPreAuthCookie(setCookie: string | null): string | null {
  if (!setCookie) {
    return null;
  }

  const pair = setCookie.split(";", 1)[0]?.trim() ?? "";
  const separator = pair.indexOf("=");
  if (separator <= 0) {
    return null;
  }

  const name = pair.slice(0, separator);
  const value = pair.slice(separator + 1);
  if (name !== PRE_AUTH_CSRF_COOKIE_NAME || value.length === 0 || /[\r\n;]/u.test(value)) {
    return null;
  }
  return `${name}=${value}`;
}

async function parseJsonBody(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function createIdentityBffHandlers(options: IdentityBffOptions): IdentityBffHandlers {
  const apiBaseUrl = resolveApiBaseUrl(options.apiBaseUrl);
  const fetchImpl = options.fetch ?? fetch;

  return Object.freeze({
    passwordForgot: async (request: Request): Promise<Response> => {
      if (!hasMatchingOrigin(request)) {
        return jsonResponse(403, {
          error: {
            code: "CSRF_ORIGIN_MISMATCH",
            message: "The request origin does not match the console origin.",
          },
        });
      }

      const payload = await parseJsonBody(request);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return jsonResponse(400, {
          error: { code: "INVALID_REQUEST", message: "The request body is invalid." },
        });
      }

      try {
        const csrfResponse = await fetchImpl(
          `${endpoint(apiBaseUrl, "/auth/csrf")}?purpose=password_forgot`,
          {
            method: "GET",
            headers: { accept: "application/json" },
            cache: "no-store",
          },
        );
        const csrfBody = csrfResponse.ok ? parseCsrfBody(await csrfResponse.json()) : null;
        const cookie = extractPreAuthCookie(csrfResponse.headers.get("set-cookie"));
        if (!csrfBody || !cookie) {
          return jsonResponse(502, {
            error: { code: "IDENTITY_UPSTREAM_UNAVAILABLE", message: "Identity service unavailable." },
          });
        }

        const upstream = await fetchImpl(endpoint(apiBaseUrl, "/auth/password/forgot"), {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            cookie,
            origin: apiBaseUrl.origin,
            "x-csrf-token": csrfBody.csrfToken,
          },
          body: JSON.stringify(payload),
          cache: "no-store",
        });

        if (!upstream.ok) {
          return jsonResponse(502, {
            error: { code: "IDENTITY_UPSTREAM_UNAVAILABLE", message: "Identity service unavailable." },
          });
        }

        return jsonResponse(202, { accepted: true });
      } catch {
        return jsonResponse(502, {
          error: { code: "IDENTITY_UPSTREAM_UNAVAILABLE", message: "Identity service unavailable." },
        });
      }
    },
  });
}
