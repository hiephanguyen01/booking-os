import assert from "node:assert/strict";
import test from "node:test";

import { MODULE_METADATA } from "@nestjs/common/constants";

import { DependenciesModule } from "../../dependencies/dependencies.module.js";
import { REDIS_CLIENT_TOKEN } from "../../dependencies/tokens.js";
import { RedisLoginAbuseProtectionAdapter } from "./infrastructure/abuse/redis-login-abuse-protection.adapter.js";
import { SessionsModule } from "./sessions.module.js";
import { LOGIN_ABUSE_PROTECTION_PORT } from "./sessions.tokens.js";

interface FactoryProvider {
  readonly provide: unknown;
  readonly inject?: readonly unknown[];
  readonly useFactory?: (...args: readonly unknown[]) => unknown;
}

function metadata<T>(key: string, target: object): readonly T[] {
  return (Reflect.getMetadata(key, target) as readonly T[] | undefined) ?? [];
}

test("composes distributed login abuse protection from the shared Redis client", () => {
  const dependencyExports = metadata<unknown>(MODULE_METADATA.EXPORTS, DependenciesModule);
  assert.ok(dependencyExports.includes(REDIS_CLIENT_TOKEN));

  const sessionImports = metadata<unknown>(MODULE_METADATA.IMPORTS, SessionsModule);
  assert.ok(sessionImports.includes(DependenciesModule));

  const providers = metadata<FactoryProvider>(MODULE_METADATA.PROVIDERS, SessionsModule);
  const abuseProvider = providers.find(
    (provider) => provider.provide === LOGIN_ABUSE_PROTECTION_PORT,
  );
  assert.ok(abuseProvider);
  assert.deepEqual(abuseProvider.inject, [REDIS_CLIENT_TOKEN]);
  assert.equal(typeof abuseProvider.useFactory, "function");

  const adapter = abuseProvider.useFactory({
    eval: async () => 0,
  });
  assert.ok(adapter instanceof RedisLoginAbuseProtectionAdapter);

  const sessionExports = metadata<unknown>(MODULE_METADATA.EXPORTS, SessionsModule);
  assert.ok(sessionExports.includes(LOGIN_ABUSE_PROTECTION_PORT));
});
