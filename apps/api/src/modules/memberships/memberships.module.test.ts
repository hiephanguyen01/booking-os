import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { AppModule } from "../../app.module.js";
import { MembershipsModule } from "./memberships.module.js";
import {
  AUTHORIZATION_QUERY_PORT,
  IDENTITY_PROVISIONING_PORT,
  SESSION_ELEVATION_PORT,
} from "./memberships.tokens.js";

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
