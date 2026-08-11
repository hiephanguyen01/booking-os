import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";

import { EnvironmentService } from "../../config/environment.service.js";

export interface SecurityRequest {
  readonly originalUrl?: string;
  readonly url?: string;
}

export interface SecurityResponse {
  getHeader(name: string): unknown;
  setHeader(name: string, value: string): void;
}

const CONTENT_SECURITY_POLICY =
  "default-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
const PERMISSIONS_POLICY = "camera=(), geolocation=(), microphone=()";
const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

function pathnameOf(request: SecurityRequest): string {
  const value = request.originalUrl ?? request.url ?? "";
  return value.split("?", 1)[0] ?? "";
}

function appendVary(response: SecurityResponse, requiredValues: readonly string[]): void {
  const existing = response.getHeader("Vary");
  const values = new Map<string, string>();

  const addValues = (value: unknown): void => {
    if (typeof value === "string") {
      for (const item of value.split(",")) {
        const trimmed = item.trim();
        if (trimmed.length > 0) values.set(trimmed.toLowerCase(), trimmed);
      }
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) addValues(item);
    }
  };

  addValues(existing);
  for (const value of requiredValues) {
    if (!values.has(value.toLowerCase())) values.set(value.toLowerCase(), value);
  }

  response.setHeader("Vary", [...values.values()].join(", "));
}

function isPathWithin(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function applyHttpSecurityPolicy(
  request: SecurityRequest,
  response: SecurityResponse,
  environment: Pick<EnvironmentService, "apiPrefix" | "isProduction">,
): void {
  response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("Permissions-Policy", PERMISSIONS_POLICY);

  if (environment.isProduction) {
    response.setHeader("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
  }

  const pathname = pathnameOf(request);
  const authPrefix = `/${environment.apiPrefix}/auth`;
  const authorizationPath = `${authPrefix}/me/authorization`;
  const invitationsPrefix = `/${environment.apiPrefix}/membership/invitations`;
  const isAuthorization = pathname === authorizationPath;
  const isSensitive = isPathWithin(pathname, authPrefix) || isPathWithin(pathname, invitationsPrefix);

  if (!isSensitive) return;

  if (response.getHeader("Cache-Control") === undefined) {
    response.setHeader("Cache-Control", isAuthorization ? "private, no-store" : "no-store");
  }

  appendVary(response, isAuthorization ? ["Cookie", "Origin"] : ["Origin"]);
}

@Injectable()
export class HttpSecurityInterceptor implements NestInterceptor {
  constructor(@Inject(EnvironmentService) private readonly environment: EnvironmentService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    applyHttpSecurityPolicy(
      http.getRequest<SecurityRequest>(),
      http.getResponse<SecurityResponse>(),
      this.environment,
    );
    return next.handle();
  }
}
