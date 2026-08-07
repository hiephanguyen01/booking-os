import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { AppModule } from "../../app.module.js";
import { ProvisionTenantUseCase } from "./application/use-cases/provision-tenant.use-case.js";
import { MembershipsModule } from "./memberships.module.js";
import {
  AUTHORIZATION_QUERY_PORT,
  IDENTITY_PROVISIONING_PORT,
  SESSION_ELEVATION_PORT,
} from "./memberships.tokens.js";

type FactoryProviderMetadata = Readonly<{
  provide?: unknown;
  useFactory?: unknown;
  inject?: readonly unknown[];
}>;

function isFactoryProviderMetadata(value: unknown): value is FactoryProviderMetadata {
  return typeof value === "object" && value !== null;
}

test("membership integration tokens are distinct symbols", () => {
  const tokens = [AUTHORIZATION_QUERY_PORT, IDENTITY_PROVISIONING_PORT, SESSION_ELEVATION_PORT];

  assert.equal(
    tokens.every((token) => typeof token === "symbol"),
    true,
  );
  assert.equal(new Set(tokens).size, tokens.length);
});

test("AppModule composes the MembershipsModule boundary", () => {
  const imports = Reflect.getMetadata("imports", AppModule) as readonly unknown[];

  assert.ok(imports.includes(MembershipsModule));
});

test("MembershipsModule wires platform tenant provisioning through an explicit factory", () => {
  const providers = (Reflect.getMetadata("providers", MembershipsModule) ??
    []) as readonly unknown[];

  assert.equal(providers.includes(ProvisionTenantUseCase), false);

  const provider = providers.find(
    (candidate) =>
      isFactoryProviderMetadata(candidate) && candidate.provide === ProvisionTenantUseCase,
  );

  assert.ok(provider);
  assert.equal(typeof provider.useFactory, "function");
  assert.ok(Array.isArray(provider.inject));
  assert.ok(provider.inject.length > 0);
});
