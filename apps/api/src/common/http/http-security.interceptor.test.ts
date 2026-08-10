import assert from "node:assert/strict";
import test from "node:test";

import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { of } from "rxjs";

import type { Environment } from "../../config/environment.schema.js";
import { EnvironmentService } from "../../config/environment.service.js";
import { HttpSecurityInterceptor } from "./http-security.interceptor.js";

class ResponseDouble {
  readonly headers = new Map<string, string>();

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }
}

function createEnvironment(nodeEnvironment: Environment["nodeEnvironment"]): EnvironmentService {
  return new EnvironmentService({
    nodeEnvironment,
    host: "127.0.0.1",
    trustProxy: false,
    tenantBaseDomain: "example.test",
    platformHostname: "platform.example.test",
    port: 3101,
    apiPrefix: "api",
    appVersion: "0.1.0-test",
    logLevel: "error",
    databaseUrl: "postgresql://booking:booking@localhost:5432/booking_os_test",
    redisUrl: "redis://localhost:6379/1",
    readinessTimeoutMs: 100,
    sessionSecret: "test-only-session-secret-at-least-32-characters",
    paymentProvider: "mock",
  });
}

function applySecurityPolicy(options: {
  readonly environment: Environment["nodeEnvironment"];
  readonly url: string;
  readonly existingCacheControl?: string;
}): ResponseDouble {
  const response = new ResponseDouble();
  if (options.existingCacheControl) {
    response.setHeader("Cache-Control", options.existingCacheControl);
  }

  const context = {
    switchToHttp: () => ({
      getRequest: () => ({ originalUrl: options.url }),
      getResponse: () => response,
      getNext: () => undefined,
    }),
  } as unknown as ExecutionContext;
  const next = { handle: () => of("ok") } satisfies CallHandler;

  new HttpSecurityInterceptor(createEnvironment(options.environment)).intercept(context, next);
  return response;
}

test("sets common browser hardening headers and defaults auth routes to private no-store", () => {
  const response = applySecurityPolicy({ environment: "test", url: "/api/auth/csrf" });

  assert.equal(
    response.getHeader("Content-Security-Policy"),
    "default-src 'none'; frame-ancestors 'none'",
  );
  assert.equal(response.getHeader("X-Frame-Options"), "DENY");
  assert.equal(response.getHeader("X-Content-Type-Options"), "nosniff");
  assert.equal(response.getHeader("Referrer-Policy"), "no-referrer");
  assert.equal(
    response.getHeader("Permissions-Policy"),
    "camera=(), geolocation=(), microphone=()",
  );
  assert.equal(response.getHeader("Cache-Control"), "private, no-store");
  assert.equal(response.getHeader("Strict-Transport-Security"), undefined);
});

test("preserves controller-specific cache policy", () => {
  const response = applySecurityPolicy({
    environment: "test",
    url: "/api/auth/csrf",
    existingCacheControl: "no-store",
  });

  assert.equal(response.getHeader("Cache-Control"), "no-store");
});

test("adds HSTS in production only", () => {
  const response = applySecurityPolicy({ environment: "production", url: "/api/auth/csrf" });

  assert.equal(
    response.getHeader("Strict-Transport-Security"),
    "max-age=31536000; includeSubDomains",
  );
});
