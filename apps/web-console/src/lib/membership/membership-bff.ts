import {
  BOOKING_SESSION_COOKIE,
  readSessionToken,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from "@booking-os/auth";

export interface MembershipBffDependencies {
  readonly apiBaseUrl: string;
  readonly fetch: typeof fetch;
}

export interface MembershipBffHandlers {
  readonly createPlatformTenant: (request: Request) => Promise<Response>;
  readonly getPlatformTenantStatus: (request: Request, tenantId: string) => Promise<Response>;
  readonly acceptInvitation: (request: Request) => Promise<Response>;
  readonly listMemberships: (request: Request) => Promise<Response>;
  readonly createInvitation: (request: Request) => Promise<Response>;
  readonly suspendMembership: (request: Request, membershipId: string) => Promise<Response>;
  readonly revokeMembership: (request: Request, membershipId: string) => Promise<Response>;
  readonly promoteOwner: (request: Request, membershipId: string) => Promise<Response>;
  readonly demoteOwner: (request: Request, membershipId: string) => Promise<Response>;
}

interface MutationOptions {
  readonly path: string;
  readonly body?: unknown;
  readonly allowSessionCookie?: boolean;
  readonly idempotencyKey?: string | null;
}

const SAFE_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
});

function normalizeApiBaseUrl(value: string): string {
  const url = new URL(value);
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1" ||
    url.hostname === "[::1]";
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Membership API base URL must be canonical HTTPS or loopback HTTP.");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
}

function apiEndpoint(baseUrl: string, path: string): string {
  return `${baseUrl}${path}`;
}

function browserTarget(request: Request): { readonly origin: string; readonly host: string } {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host")?.trim() || requestUrl.host;
  const forwardedProtocol = request.headers
    .get("x-forwarded-proto")
    ?.split(",", 1)[0]
    ?.trim()
    .toLowerCase();
  const protocol =
    forwardedProtocol === "http" || forwardedProtocol === "https"
      ? `${forwardedProtocol}:`
      : requestUrl.protocol;
  return { origin: new URL(`${protocol}//${host}`).origin, host };
}

function exactSessionCookie(cookieHeader: string | null): string | null {
  const token = readSessionToken(cookieHeader);
  return token === undefined ? null : `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

function problem(status: number, code: string, message: string): Response {
  return Response.json(
    { code, message },
    {
      status,
      headers: {
        ...SAFE_HEADERS,
        "content-type": "application/problem+json",
      },
    },
  );
}

function sanitizedSetCookie(setCookie: string | null): string | null {
  if (setCookie === null) return null;
  const [pair, ...attributes] = setCookie.split(";").map((part) => part.trim());
  const separator = pair?.indexOf("=") ?? -1;
  if (separator <= 0 || pair?.slice(0, separator) !== BOOKING_SESSION_COOKIE) return null;
  const encodedValue = pair.slice(separator + 1);
  if (encodedValue === "") {
    const expired = attributes.some((attribute) => attribute.toLowerCase() === "max-age=0");
    return expired ? serializeExpiredSessionCookie() : null;
  }
  const token = readSessionToken(`${BOOKING_SESSION_COOKIE}=${encodedValue}`);
  return token === undefined ? null : serializeSessionCookie(token);
}

async function forward(upstream: Response, allowSessionCookie = false): Promise<Response> {
  const headers = new Headers(SAFE_HEADERS);
  const contentType = upstream.headers.get("content-type");
  if (contentType !== null) headers.set("content-type", contentType);
  if (allowSessionCookie) {
    const setCookie = sanitizedSetCookie(upstream.headers.get("set-cookie"));
    if (setCookie !== null) headers.set("set-cookie", setCookie);
  }
  const body = await upstream.text();
  return new Response(body === "" ? null : body, {
    status: upstream.status,
    headers,
  });
}

async function readObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = await request.json();
    return typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

function readCsrfToken(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  return readString((payload as Record<string, unknown>).csrfToken);
}

export function createMembershipBffHandlers(
  dependencies: MembershipBffDependencies,
): MembershipBffHandlers {
  const apiBaseUrl = normalizeApiBaseUrl(dependencies.apiBaseUrl);

  async function sessionCsrf(request: Request, cookie: string): Promise<string | null> {
    const target = browserTarget(request);
    const response = await dependencies.fetch(apiEndpoint(apiBaseUrl, "/auth/session/csrf"), {
      method: "GET",
      headers: {
        accept: "application/json",
        cookie,
        "x-forwarded-host": target.host,
      },
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) return null;
    return readCsrfToken(await response.json());
  }

  async function authenticatedGet(request: Request, path: string): Promise<Response> {
    const cookie = exactSessionCookie(request.headers.get("cookie"));
    if (cookie === null)
      return problem(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
    const target = browserTarget(request);
    try {
      const upstream = await dependencies.fetch(apiEndpoint(apiBaseUrl, path), {
        method: "GET",
        headers: {
          accept: "application/json",
          cookie,
          "x-forwarded-host": target.host,
        },
        cache: "no-store",
        redirect: "error",
      });
      return forward(upstream);
    } catch {
      return problem(503, "API_UNAVAILABLE", "Booking OS API is unavailable.");
    }
  }

  async function authenticatedMutation(
    request: Request,
    options: MutationOptions,
  ): Promise<Response> {
    const target = browserTarget(request);
    if (request.headers.get("origin") !== target.origin) {
      return problem(403, "ORIGIN_NOT_ALLOWED", "Request origin is not allowed.");
    }
    const cookie = exactSessionCookie(request.headers.get("cookie"));
    if (cookie === null)
      return problem(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");

    try {
      const csrfToken = await sessionCsrf(request, cookie);
      if (csrfToken === null) {
        return problem(503, "SESSION_CSRF_UNAVAILABLE", "Session CSRF token is unavailable.");
      }
      const headers = new Headers({
        accept: "application/json",
        cookie,
        origin: target.origin,
        "x-csrf-token": csrfToken,
        "x-forwarded-host": target.host,
      });
      let body: string | undefined;
      if (options.body !== undefined) {
        headers.set("content-type", "application/json");
        body = JSON.stringify(options.body);
      }
      if (options.idempotencyKey !== undefined && options.idempotencyKey !== null) {
        headers.set("idempotency-key", options.idempotencyKey);
      }
      const upstream = await dependencies.fetch(apiEndpoint(apiBaseUrl, options.path), {
        method: "POST",
        headers,
        ...(body === undefined ? {} : { body }),
        cache: "no-store",
        redirect: "error",
      });
      return forward(upstream, options.allowSessionCookie);
    } catch {
      return problem(503, "API_UNAVAILABLE", "Booking OS API is unavailable.");
    }
  }

  return {
    async createPlatformTenant(request) {
      const body = await readObject(request);
      const slug = readString(body?.slug);
      const tenantName = readString(body?.tenantName);
      const ownerEmail = readString(body?.ownerEmail);
      const idempotencyKey = readString(request.headers.get("idempotency-key"));
      if (slug === null || tenantName === null || ownerEmail === null || idempotencyKey === null) {
        return problem(400, "INVALID_TENANT_REQUEST", "Tenant provisioning request is invalid.");
      }
      return authenticatedMutation(request, {
        path: "/platform/tenants",
        idempotencyKey,
        body: { slug, tenantName, ownerEmail },
      });
    },
    getPlatformTenantStatus: (request, tenantId) =>
      authenticatedGet(request, `/platform/tenants/${encodeURIComponent(tenantId)}`),
    async acceptInvitation(request) {
      const body = await readObject(request);
      const token = readString(body?.token);
      if (token === null) {
        return problem(400, "INVALID_INVITATION_REQUEST", "Invitation token is required.");
      }
      return authenticatedMutation(request, {
        path: "/membership/invitations/accept",
        body: { token },
        allowSessionCookie: true,
      });
    },
    listMemberships: (request) => authenticatedGet(request, "/memberships"),
    async createInvitation(request) {
      const body = await readObject(request);
      const email = readString(body?.email);
      if (email === null) {
        return problem(400, "INVALID_INVITATION_REQUEST", "Invitation email is required.");
      }
      return authenticatedMutation(request, {
        path: "/membership/invitations",
        body: { email },
      });
    },
    suspendMembership: (request, membershipId) =>
      authenticatedMutation(request, {
        path: `/memberships/${encodeURIComponent(membershipId)}/suspend`,
      }),
    revokeMembership: (request, membershipId) =>
      authenticatedMutation(request, {
        path: `/memberships/${encodeURIComponent(membershipId)}/revoke`,
      }),
    promoteOwner: (request, membershipId) =>
      authenticatedMutation(request, {
        path: `/memberships/${encodeURIComponent(membershipId)}/promote-owner`,
      }),
    demoteOwner: (request, membershipId) =>
      authenticatedMutation(request, {
        path: `/memberships/${encodeURIComponent(membershipId)}/demote-owner`,
      }),
  };
}
