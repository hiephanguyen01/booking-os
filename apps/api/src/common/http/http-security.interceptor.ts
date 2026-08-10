import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import type { Observable } from "rxjs";

import { EnvironmentService } from "../../config/environment.service.js";

interface SecurityRequest {
  readonly originalUrl?: string;
  readonly url?: string;
}

interface SecurityResponse {
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

@Injectable()
export class HttpSecurityInterceptor implements NestInterceptor {
  constructor(private readonly environment: EnvironmentService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<SecurityRequest>();
    const response = http.getResponse<SecurityResponse>();

    response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("Permissions-Policy", PERMISSIONS_POLICY);

    if (this.environment.isProduction) {
      response.setHeader("Strict-Transport-Security", STRICT_TRANSPORT_SECURITY);
    }

    const authPrefix = `/${this.environment.apiPrefix}/auth`;
    const pathname = pathnameOf(request);
    if (
      (pathname === authPrefix || pathname.startsWith(`${authPrefix}/`)) &&
      response.getHeader("Cache-Control") === undefined
    ) {
      response.setHeader("Cache-Control", "private, no-store");
    }

    return next.handle();
  }
}
