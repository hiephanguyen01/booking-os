import assert from "node:assert/strict";
import test from "node:test";

import type { StructuredLogger } from "@booking-os/observability";

import { DependenciesModule } from "../../dependencies/dependencies.module.js";
import { REDIS_CLIENT_TOKEN } from "../../dependencies/tokens.js";
import { API_LOGGER_TOKEN } from "../../observability/tokens.js";
import { RedisLoginAbuseProtectionAdapter } from "./infrastructure/abuse/redis-login-abuse-protection.adapter.js";
import { StructuredLoginAbuseMetricsAdapter } from "./infrastructure/observability/structured-login-abuse-metrics.adapter.js";
import { SessionsModule } from "./sessions.module.js";
import { LOGIN_ABUSE_METRICS_PORT, LOGIN_ABUSE_PROTECTION_PORT } from "./sessions.tokens.js";

const MODULE_METADATA = Object.freeze({
  imports: "imports",
  providers: "providers",
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
