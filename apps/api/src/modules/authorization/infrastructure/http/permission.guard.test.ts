import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import {
  BOOKING_SESSION_COOKIE,
  createSessionToken,
  PERMISSION_KEYS,
  serializeSessionCookie,
} from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";
import { type ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import type { AuthorizationDeniedAuditRecord } from "../../application/ports/authorization-security-audit.port.js";
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
  const audits: AuthorizationDeniedAuditRecord[] = [];
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
    {
      async recordDenied(record) {
        audits.push(record);
      },
    },
  );
  return { instance, resolves: () => resolves, audits };
}

function assertBoundedDenialAudit(
  audit: AuthorizationDeniedAuditRecord | undefined,
  reason: AuthorizationDeniedAuditRecord["reason"],
): void {
  assert.equal(audit?.eventType, "authorization.denied");
  assert.equal(audit?.actorUserId, USER_ID);
  assert.equal(audit?.subjectUserId, USER_ID);
  assert.equal(audit?.sessionId, SESSION_ID);
  assert.equal(audit?.requestId, "request-permission");
  assert.equal(audit?.permission, "tenant.membership.read");
  assert.equal(audit?.scopeType, "tenant");
  assert.equal(audit?.tenantId, TENANT_ID);
  assert.equal(audit?.reason, reason);
  assert.equal(JSON.stringify(audit).includes(PRESENTED_TOKEN), false);
}

test("allows explicitly exempt invitation routes without resolving authority", async () => {
  const fixture = guard();
  assert.equal(await fixture.instance.canActivate(execution("exempt").context), true);
  assert.equal(fixture.resolves(), 0);
  assert.equal(fixture.audits.length, 0);
});

test("rejects unclassified routes without resolving authority or emitting a subject audit", async () => {
  const fixture = guard();
  await assert.rejects(
    fixture.instance.canActivate(execution("missing").context),
    ForbiddenException,
  );
  assert.equal(fixture.resolves(), 0);
  assert.equal(fixture.audits.length, 0);
});

test("rejects missing and invitation-pending sessions before resolving authority", async () => {
  const missing = guard();
  await assert.rejects(missing.instance.canActivate(execution().context), UnauthorizedException);
  assert.equal(missing.resolves(), 0);
  assert.equal(missing.audits.length, 0);

  const pending = guard({
    authenticated: { ...AUTHENTICATED, sessionState: "invitation_pending" },
  });
  await assert.rejects(pending.instance.canActivate(execution().context), ForbiddenException);
  assert.equal(pending.resolves(), 0);
  assert.equal(pending.audits.length, 1);
  assertBoundedDenialAudit(pending.audits[0], "session_inactive");
});

test("rejects resolver failures, wrong scope, inactive membership, missing permission, and stale user version", async () => {
  const { membershipStatus: _membershipStatus, ...missingMembership } = AUTHORIZATION;
  const cases: readonly {
    readonly name: string;
    readonly authorization?: AuthorizationContext | undefined;
    readonly error?: Error | undefined;
    readonly reason: AuthorizationDeniedAuditRecord["reason"];
  }[] = [
    {
      name: "resolver denial",
      error: new AuthorizationSubjectInactiveError(),
      reason: "subject_inactive",
    },
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
      reason: "authority_mismatch",
    },
    {
      name: "inactive membership",
      authorization: missingMembership,
      reason: "authority_mismatch",
    },
    {
      name: "missing permission",
      authorization: { ...AUTHORIZATION, permissionKeys: [] },
      reason: "authority_mismatch",
    },
    {
      name: "stale user version",
      authorization: { ...AUTHORIZATION, userAuthorizationVersion: 5 },
      reason: "authority_mismatch",
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
    assert.equal(fixture.audits.length, 1, entry.name);
    assertBoundedDenialAudit(fixture.audits[0], entry.reason);
  }
});

test("propagates unexpected resolver failures for centralized error handling without denial audit", async () => {
  const unexpected = new Error("authority unavailable");
  const fixture = guard({ authenticated: AUTHENTICATED, error: unexpected });
  await assert.rejects(fixture.instance.canActivate(execution().context), unexpected);
  assert.equal(fixture.audits.length, 0);
});

test("allows a route when authority satisfies any declared permission", async () => {
  const fixture = guard({ authenticated: AUTHENTICATED, authorization: AUTHORIZATION });
  const target = execution();
  Reflect.defineMetadata(
    REQUIRES_PERMISSION_METADATA,
    [PERMISSION_KEYS.tenantRbacRolePermissionGrant, PERMISSION_KEYS.tenantMembershipRead],
    target.context.getHandler(),
  );

  assert.equal(await fixture.instance.canActivate(target.context), true);
  assert.equal(fixture.resolves(), 1);
  assert.equal(fixture.audits.length, 0);
  assert.equal(authorizationContextFromRequest(target.request), AUTHORIZATION);
});

test("allows matching permission and exposes immutable authority to the controller request", async () => {
  const fixture = guard({ authenticated: AUTHENTICATED, authorization: AUTHORIZATION });
  const target = execution();

  assert.equal(await fixture.instance.canActivate(target.context), true);
  assert.equal(fixture.resolves(), 1);
  assert.equal(fixture.audits.length, 0);
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
  assert.equal(fixture.audits.length, 0);
  assert.equal(target.responseHeaders.get("Set-Cookie"), serializeSessionCookie(successorToken));
});
