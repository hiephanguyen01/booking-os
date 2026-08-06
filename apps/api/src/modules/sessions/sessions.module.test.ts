import assert from "node:assert/strict";
import test from "node:test";

import type { StructuredLogger } from "@booking-os/observability";

import { AppModule } from "../../app.module.js";
import { RequestContextStorage } from "../../common/request-context/request-context.storage.js";
import { EnvironmentService } from "../../config/environment.service.js";
import { DependenciesModule } from "../../dependencies/dependencies.module.js";
import { REDIS_CLIENT_TOKEN } from "../../dependencies/tokens.js";
import { API_LOGGER_TOKEN } from "../../observability/tokens.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { ListSessionsUseCase } from "./application/use-cases/list-sessions.js";
import { RefreshSessionUseCase } from "./application/use-cases/refresh-session.js";
import { RevokeOtherSessionsUseCase } from "./application/use-cases/revoke-other-sessions.js";
import { RedisLoginAbuseProtectionAdapter } from "./infrastructure/abuse/redis-login-abuse-protection.adapter.js";
import { SessionCsrfHttpController } from "./infrastructure/http/session-csrf-http.controller.js";
import { SessionCsrfGuard } from "./infrastructure/http/session-csrf.guard.js";
import { SessionHttpController } from "./infrastructure/http/session-http.controller.js";
import { StructuredLoginAbuseMetricsAdapter } from "./infrastructure/observability/structured-login-abuse-metrics.adapter.js";
import { SessionsModule } from "./sessions.module.js";
import { LOGIN_ABUSE_METRICS_PORT, LOGIN_ABUSE_PROTECTION_PORT } from "./sessions.tokens.js";

const MODULE_METADATA = Object.freeze({
  imports: "imports",
  providers: "providers",
  controllers: "controllers",
  exports: "exports",
});

interface FactoryProvider {
  readonly provide: unknown;
  readonly inject?: readonly unknown[];
  readonly useFactory?: (...args: readonly unknown[]) => unknown;
}

function metadata<T>(key: string, target: object): readonly T[] {
  return (Reflect.getMetadata(key, target) as readonly T[] | undefined) ?? [];
}

const logger: StructuredLogger = Object.freeze({
  child: () => logger,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
});

test("composes distributed login abuse protection with bounded telemetry", () => {
  const dependencyExports = metadata<unknown>(MODULE_METADATA.exports, DependenciesModule);
  assert.ok(dependencyExports.includes(REDIS_CLIENT_TOKEN));

  const sessionImports = metadata<unknown>(MODULE_METADATA.imports, SessionsModule);
  assert.ok(sessionImports.includes(DependenciesModule));

  const providers = metadata<FactoryProvider>(MODULE_METADATA.providers, SessionsModule);
  const metricsProvider = providers.find(
    (provider) => provider.provide === LOGIN_ABUSE_METRICS_PORT,
  );
  assert.ok(metricsProvider);
  assert.deepEqual(metricsProvider.inject, [API_LOGGER_TOKEN]);
  assert.equal(typeof metricsProvider.useFactory, "function");
  if (typeof metricsProvider.useFactory !== "function") {
    throw new TypeError("Login abuse metrics provider must define a factory.");
  }
  const metrics = metricsProvider.useFactory(logger);
  assert.ok(metrics instanceof StructuredLoginAbuseMetricsAdapter);

  const abuseProvider = providers.find(
    (provider) => provider.provide === LOGIN_ABUSE_PROTECTION_PORT,
  );
  assert.ok(abuseProvider);
  assert.deepEqual(abuseProvider.inject, [REDIS_CLIENT_TOKEN, LOGIN_ABUSE_METRICS_PORT]);

  const useFactory = abuseProvider.useFactory;
  assert.equal(typeof useFactory, "function");
  if (typeof useFactory !== "function") {
    throw new TypeError("Login abuse protection provider must define a factory.");
  }

  const adapter = useFactory(
    {
      eval: async () => 0,
    },
    metrics,
  );
  assert.ok(adapter instanceof RedisLoginAbuseProtectionAdapter);

  const sessionExports = metadata<unknown>(MODULE_METADATA.exports, SessionsModule);
  assert.ok(sessionExports.includes(LOGIN_ABUSE_PROTECTION_PORT));
});

test("wires the session HTTP controller and device-management use cases", () => {
  const controllers = metadata<unknown>(MODULE_METADATA.controllers, SessionsModule);
  assert.ok(controllers.includes(SessionHttpController));

  const providers = metadata<FactoryProvider>(MODULE_METADATA.providers, SessionsModule);
  assert.ok(providers.some((provider) => provider.provide === ListSessionsUseCase));
  assert.ok(providers.some((provider) => provider.provide === RevokeOtherSessionsUseCase));
  assert.ok(providers.some((provider) => provider.provide === RefreshSessionUseCase));
});

test("wires session CSRF issuance and enforcement into the runtime module", () => {
  const controllers = metadata<unknown>(MODULE_METADATA.controllers, SessionsModule);
  assert.ok(controllers.includes(SessionCsrfHttpController));
  assert.equal(Reflect.getMetadata("path", SessionCsrfHttpController), "auth/session");

  const providers = metadata<unknown>(MODULE_METADATA.providers, SessionsModule);
  assert.ok(providers.includes(SessionCsrfGuard));
  assert.deepEqual(Reflect.getMetadata("design:paramtypes", SessionCsrfGuard), [
    RequestContextStorage,
    EnvironmentService,
  ]);

  const guards = metadata<unknown>("__guards__", SessionHttpController);
  assert.ok(guards.includes(SessionCsrfGuard));
});

test("orders trusted tenant resolution before session authentication", () => {
  const imports = metadata<unknown>(MODULE_METADATA.imports, AppModule);
  const tenancyIndex = imports.indexOf(TenancyModule);
  const sessionsIndex = imports.indexOf(SessionsModule);

  assert.notEqual(tenancyIndex, -1);
  assert.notEqual(sessionsIndex, -1);
  assert.ok(tenancyIndex < sessionsIndex);
});
