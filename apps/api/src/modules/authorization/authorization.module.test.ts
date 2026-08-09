import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { AppModule } from "../../app.module.js";
import { AuthorizationModule } from "./authorization.module.js";
import {
  AUTHORIZATION_REPOSITORY_PORT,
  SESSION_AUTHORIZATION_REFRESH_PORT,
} from "./authorization.tokens.js";

test("authorization integration tokens are distinct symbols", () => {
  assert.equal(typeof AUTHORIZATION_REPOSITORY_PORT, "symbol");
  assert.equal(typeof SESSION_AUTHORIZATION_REFRESH_PORT, "symbol");
  assert.notEqual(AUTHORIZATION_REPOSITORY_PORT, SESSION_AUTHORIZATION_REFRESH_PORT);
});

test("AppModule composes the AuthorizationModule boundary", () => {
  const imports = Reflect.getMetadata("imports", AppModule) as readonly unknown[];

  assert.ok(imports.includes(AuthorizationModule));
});
