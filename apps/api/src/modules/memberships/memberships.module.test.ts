import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { AppModule } from "../../app.module.js";
import { MembershipsModule } from "./memberships.module.js";
import {
  AUTHORIZATION_QUERY_PORT,
  IDENTITY_PROVISIONING_PORT,
  MEMBERSHIP_INVITATION_ENVELOPE_PORT,
  MEMBERSHIP_INVITATION_TOKEN_PORT,
  PLATFORM_TENANT_PROVISIONING_TRANSACTION_PORT,
  SESSION_ELEVATION_PORT,
  TENANT_ACTIVATION_ENVELOPE_PORT,
  TENANT_ACTIVATION_TOKEN_PORT,
} from "./memberships.tokens.js";

test("membership integration tokens are distinct symbols", () => {
  const tokens = [
    AUTHORIZATION_QUERY_PORT,
    IDENTITY_PROVISIONING_PORT,
    SESSION_ELEVATION_PORT,
    PLATFORM_TENANT_PROVISIONING_TRANSACTION_PORT,
    MEMBERSHIP_INVITATION_TOKEN_PORT,
    MEMBERSHIP_INVITATION_ENVELOPE_PORT,
    TENANT_ACTIVATION_TOKEN_PORT,
    TENANT_ACTIVATION_ENVELOPE_PORT,
  ];

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
