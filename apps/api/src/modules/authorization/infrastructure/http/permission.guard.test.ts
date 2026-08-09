import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOKING_SESSION_COOKIE,
  createSessionToken,
  serializeSessionCookie,
} from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";
import { type ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import { AuthorizationSubjectInactiveError } from "../../domain/authorization.errors.js";
import { authorizationContextFromRequest, PermissionGuard } from "./permission.guard.js";
import {
  PERMISSION_GUARD_EXEMPT_METADATA,
  REQUIRES_PERMISSION_METADATA,
} from "./requires-permission.decorator.js";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const SESSION_ID = "20000000-0000-4000-8000-000000000001";
const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const PRESENTED_TOKEN = createSessionToken();
const AUTHENTICATED: AuthenticatedRequestContext = Object.freeze({
  requestId: "request-permission",
  traceId: "trace-permission",
  source: "internal",
  actorId: USER_ID,
  sessionId: SESSION_ID,
  authScope: Object.freeze({ type: "tenant", tenantId: TENANT_ID }),
  sessionState: "active",
  authorizationVersion: 4,
  membershipAuthorizationVersion: 7,
});
const AUTHORIZATION: AuthorizationContext = Object.freeze({
  userId: USER_ID,
  sessionId: SESSION_ID,
  scope: Object.freeze({ type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" }),
  membershipId: "40000000-0000-4000-8000-000000000001",
  membershipStatus: "active",
  roleKeys: Object.freeze(["tenant_admin"] as const),
  permissionKeys: Object.freeze(["tenant.membership.read"] as const),
  userAuthorizationVersion: 4,
  membershipAuthorizationVersion: 7,
});

function execution(classification: "permission" | "exempt" | "missing" = "permission"): {
  readonly context: ExecutionContext;
  readonly request: object;
  readonly responseHeaders: ReadonlyMap<string, string>;
} {
  const handler = () => undefined;
  if (classification === "permission") {
    Reflect.defineMetadata(REQUIRES_PERMISSION_METADATA, "tenant.membership.read", handler);
  } else if (classification === "exempt") {
    Reflect.defineMetadata(PERMISSION_GUARD_EXEMPT_METADATA, "invitation_pending", handler);
  }
  const request = {
    headers: { cookie: `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(PRESENTED_TOKEN)}` },
  };
  const responseHeaders = new Map<string, string>();
  return {
    request,
    responseHeaders,
    context: {
      getHandler: () => handler,
      getClass: () => class TestController {},
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({
          setHeader: (name: string, value: string) => responseHeaders.set(name, value),
        }),
      }),
    } as unknown as ExecutionContext,
  };
}

function guard(input?: {
  readonly authenticated?: AuthenticatedRequestContext | undefined;
  readonly authorization?: AuthorizationContext | undefined;
  readonly error?: Error | undefined;
  readonly successorToken?: string | undefined;
}) {
  let resolves = 0;
  const instance = new PermissionGuard(
    new Reflector(),
    {
      getAuthenticated: () => input?.authenticated,
    } as never,
    {
      async execute() {
        resolves += 1;
        if (input?.error) throw input.error;
        const context = input?.authorization ?? AUTHORIZATION;
        return input?.successorToken
          ? { status: "refreshed" as const, context, successorToken: input.successorToken }
          : { status: "current" as const, context };
      },
    },
  );
  return { instance, resolves: () => resolves };
}

test("allows explicitly exempt invitation routes without resolving authority", async () => {
  const fixture = guard();
  assert.equal(await fixture.instance.canActivate(execution("exempt").context), true);
  assert.equal(fixture.resolves(), 0);
});

test("rejects unclassified routes without resolving authority", async () => {
  const fixture = guard();
  await assert.rejects(
    fixture.instance.canActivate(execution("missing").context),
    ForbiddenException,
  );
  assert.equal(fixture.resolves(), 0);
});

test("rejects missing and invitation-pending sessions before resolving authority", async () => {
  const missing = guard();
  await assert.rejects(missing.instance.canActivate(execution().context), UnauthorizedException);
  assert.equal(missing.resolves(), 0);

  const pending = guard({
    authenticated: { ...AUTHENTICATED, sessionState: "invitation_pending" },
  });
  await assert.rejects(pending.instance.canActivate(execution().context), ForbiddenException);
  assert.equal(pending.resolves(), 0);
});

test("rejects resolver failures, wrong scope, inactive membership, missing permission, and stale user version", async () => {
  const { membershipStatus: _membershipStatus, ...missingMembership } = AUTHORIZATION;
  const cases: readonly {
    readonly name: string;
    readonly authorization?: AuthorizationContext | undefined;
    readonly error?: Error | undefined;
  }[] = [
    { name: "resolver denial", error: new AuthorizationSubjectInactiveError() },
    {
      name: "wrong scope",
      authorization: {
        ...AUTHORIZATION,
        scope: {
          type: "tenant",
          tenantId: "30000000-0000-4000-8000-000000000002",
          tenantSlug: "other",
        },
      },
    },
    {
      name: "inactive membership",
      authorization: missingMembership,
    },
    { name: "missing permission", authorization: { ...AUTHORIZATION, permissionKeys: [] } },
    {
      name: "stale user version",
      authorization: { ...AUTHORIZATION, userAuthorizationVersion: 5 },
    },
  ];

  for (const entry of cases) {
    const fixture = guard({
      authenticated: AUTHENTICATED,
      authorization: entry.authorization,
      error: entry.error,
    });
    await assert.rejects(
      fixture.instance.canActivate(execution().context),
      ForbiddenException,
      entry.name,
    );
  }
});

test("propagates unexpected resolver failures for centralized error handling", async () => {
  const unexpected = new Error("authority unavailable");
  const fixture = guard({ authenticated: AUTHENTICATED, error: unexpected });
  await assert.rejects(fixture.instance.canActivate(execution().context), unexpected);
});

test("allows matching permission and exposes immutable authority to the controller request", async () => {
  const fixture = guard({ authenticated: AUTHENTICATED, authorization: AUTHORIZATION });
  const target = execution();

  assert.equal(await fixture.instance.canActivate(target.context), true);
  assert.equal(fixture.resolves(), 1);
  assert.equal(authorizationContextFromRequest(target.request), AUTHORIZATION);
});

test("writes a rotated opaque session only through Set-Cookie", async () => {
  const successorToken = createSessionToken();
  const fixture = guard({
    authenticated: AUTHENTICATED,
    authorization: {
      ...AUTHORIZATION,
      userAuthorizationVersion: 5,
      membershipAuthorizationVersion: 8,
    },
    successorToken,
  });
  const target = execution();

  assert.equal(await fixture.instance.canActivate(target.context), true);
  assert.equal(target.responseHeaders.get("Set-Cookie"), serializeSessionCookie(successorToken));
});
