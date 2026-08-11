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

const CONTENT_SECURITY_POLICY = "default-src 'none'; frame-ancestors 'none'";
const PERMISSIONS_POLICY = "camera=(), geolocation=(), microphone=()";
const STRICT_TRANSPORT_SECURITY = "max-age=31536000; includeSubDomains";

function pathnameOf(request: SecurityRequest): string {
  const value = request.originalUrl ?? request.url ?? "";
  return value.split("?", 1)[0] ?? "";
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

  const authPrefix = `/${environment.apiPrefix}/auth`;
  const pathname = pathnameOf(request);
  if (
    (pathname === authPrefix || pathname.startsWith(`${authPrefix}/`)) &&
    response.getHeader("Cache-Control") === undefined
  ) {
    response.setHeader("Cache-Control", "private, no-store");
  }
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
