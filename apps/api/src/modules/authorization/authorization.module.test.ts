import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { AppModule } from "../../app.module.js";
import { TenantRbacController } from "./infrastructure/http/tenant-rbac.controller.js";
import { AuthorizationModule } from "./authorization.module.js";
import {
  AUTHORIZATION_REPOSITORY_PORT,
  AUTHORIZATION_SECURITY_AUDIT_PORT,
  PROTECTED_REQUEST_AUTHORIZATION_PORT,
  SESSION_AUTHORIZATION_REFRESH_PORT,
} from "./authorization.tokens.js";

test("authorization integration tokens are distinct symbols", () => {
  const tokens = [
    AUTHORIZATION_REPOSITORY_PORT,
    AUTHORIZATION_SECURITY_AUDIT_PORT,
    PROTECTED_REQUEST_AUTHORIZATION_PORT,
    SESSION_AUTHORIZATION_REFRESH_PORT,
  ];
  assert.equal(
    tokens.every((token) => typeof token === "symbol"),
    true,
  );
  assert.equal(new Set(tokens).size, tokens.length);
});

test("AppModule composes the AuthorizationModule boundary", () => {
  const imports = Reflect.getMetadata("imports", AppModule) as readonly unknown[];

  assert.ok(imports.includes(AuthorizationModule));
});

test("AuthorizationModule exports the security audit port required by exported guards", () => {
  const exports = Reflect.getMetadata("exports", AuthorizationModule) as readonly unknown[];

  assert.ok(exports.includes(AUTHORIZATION_SECURITY_AUDIT_PORT));
});

test("AuthorizationModule composes the tenant RBAC HTTP controller", () => {
  const controllers = Reflect.getMetadata("controllers", AuthorizationModule) as readonly unknown[];

  assert.ok(controllers.includes(TenantRbacController));
});
