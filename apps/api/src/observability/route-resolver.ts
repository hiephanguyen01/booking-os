export interface RoutableRequest {
  readonly baseUrl?: string;
  readonly originalUrl?: string;
  readonly url?: string;
  readonly route?: {
    readonly path?: unknown;
  };
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\/{2,}/g, "/");
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;

  return withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/$/, "") : withLeadingSlash;
}

function fallbackPathname(request: RoutableRequest): string {
  const source = request.originalUrl ?? request.url ?? "/";

  try {
    return new URL(source, "http://localhost").pathname;
  } catch {
    return source.split("?", 1)[0] ?? "/";
  }
}

export function resolveRequestRoute(request: RoutableRequest): string {
  const routePath = request.route?.path;

  if (typeof routePath === "string") {
    return normalizePath(`${request.baseUrl ?? ""}/${routePath}`);
  }

  return normalizePath(fallbackPathname(request));
}

export function isSuccessfulHealthRoute(
  route: string,
  statusCode: number,
  apiPrefix: string,
): boolean {
  if (statusCode !== 200) {
    return false;
  }

  const prefix = normalizePath(apiPrefix);
  const normalizedRoute = normalizePath(route);

  return normalizedRoute === `${prefix}/health` || normalizedRoute === `${prefix}/ready`;
}
