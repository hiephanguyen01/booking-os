import assert from "node:assert/strict";
import test from "node:test";

import { BOOKING_SESSION_COOKIE, createSessionToken } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";
import { Controller, Get, UseGuards } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { RequestContextStorage } from "../src/common/request-context/request-context.storage.js";
import { PROTECTED_REQUEST_AUTHORIZATION_PORT } from "../src/modules/authorization/authorization.tokens.js";
import { PermissionGuard } from "../src/modules/authorization/infrastructure/http/permission.guard.js";
import { RequiresPermission } from "../src/modules/authorization/infrastructure/http/requires-permission.decorator.js";

const TENANT_ID = "b1000000-0000-4000-8000-000000000001";
const USER_ID = "b2000000-0000-4000-8000-000000000001";
const SESSION_ID = "b3000000-0000-4000-8000-000000000001";
const TOKEN = createSessionToken();

let useCaseCalls = 0;

@UseGuards(PermissionGuard)
@Controller("authorization-order")
class AuthorizationOrderController {
  @RequiresPermission("tenant.membership.read")
  @Get()
  execute(): { readonly reached: true } {
    useCaseCalls += 1;
    return { reached: true };
  }
}

test("authoritative denial occurs before controller or use-case invocation", async () => {
  const baseAuthorization: AuthorizationContext = {
    userId: USER_ID,
    sessionId: SESSION_ID,
    scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "authorization-order" },
    membershipId: "b4000000-0000-4000-8000-000000000001",
    membershipStatus: "active",
    roleKeys: ["tenant_admin"],
    permissionKeys: [],
    userAuthorizationVersion: 2,
    membershipAuthorizationVersion: 3,
  };
  let authorization = baseAuthorization;
  const module = await Test.createTestingModule({
    controllers: [AuthorizationOrderController],
    providers: [
      Reflector,
      PermissionGuard,
      {
        provide: RequestContextStorage,
        useValue: {
          getAuthenticated: () => ({
            requestId: "authorization-order",
            traceId: "b5000000-0000-4000-8000-000000000001",
            source: "internal",
            tenantId: TENANT_ID,
            actorId: USER_ID,
            sessionId: SESSION_ID,
            authScope: { type: "tenant", tenantId: TENANT_ID },
            sessionState: "active",
            authorizationVersion: 2,
            membershipAuthorizationVersion: 3,
          }),
        },
      },
      {
        provide: PROTECTED_REQUEST_AUTHORIZATION_PORT,
        useValue: {
          execute: async () => ({ status: "current" as const, context: authorization }),
        },
      },
    ],
  }).compile();
  const app = module.createNestApplication();
  await app.init();
  useCaseCalls = 0;

  try {
    const cookie = `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(TOKEN)}`;
    await request(app.getHttpServer())
      .get("/authorization-order")
      .set("cookie", cookie)
      .set("x-user-id", "attacker")
      .set("x-session-id", "attacker")
      .set("x-role", "platform_admin")
      .set("x-permission", "platform.tenants.provision")
      .set("x-authorization-version", "999")
      .expect(403);
    assert.equal(useCaseCalls, 0);

    authorization = {
      ...baseAuthorization,
      permissionKeys: ["tenant.membership.read"],
    };
    await request(app.getHttpServer())
      .get("/authorization-order")
      .set("cookie", cookie)
      .expect(200, { reached: true });
    assert.equal(useCaseCalls, 1);
  } finally {
    await app.close();
  }
});
