import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import { TenantAuthorizationStaleError } from "../../../tenancy/application/tenant-context.errors.js";
import { RoleGrantNotAllowedError } from "../../domain/membership-errors.js";
import { InviteTenantAdminUseCase } from "./invite-tenant-admin.use-case.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-08T01:00:00.000Z");

function authorization(
  role: "tenant_owner" | "tenant_admin",
  withPermission = true,
): AuthorizationContext {
  return Object.freeze({
    userId: ACTOR_ID,
    sessionId: "20000000-0000-4000-8000-000000000001",
    scope: Object.freeze({ type: "tenant" as const, tenantId: TENANT_ID, tenantSlug: "acme" }),
    membershipId: "40000000-0000-4000-8000-000000000001",
    membershipStatus: "active" as const,
    roleKeys: Object.freeze([role]),
    permissionKeys: withPermission
      ? Object.freeze([PERMISSION_KEYS.tenantMembershipAdminInvite])
      : Object.freeze([]),
    userAuthorizationVersion: 1,
    membershipAuthorizationVersion: 1,
  });
}

function createHarness(transactionError?: Error) {
  const calls: unknown[] = [];
  const transactionContexts: unknown[] = [];
  const workflow = {
    async inviteTenantAdmin(input: unknown) {
      calls.push(input);
      return Object.freeze({ accepted: true as const });
    },
    async resendInvitation() {
      throw new Error("not used");
    },
    async getCurrentInvitation() {
      throw new Error("not used");
    },
  };
  return {
    calls,
    transactionContexts,
    useCase: new InviteTenantAdminUseCase(
      workflow,
      {
        async run(context, work) {
          transactionContexts.push(context);
          if (transactionError) throw transactionError;
          return work({} as never);
        },
      },
      () => NOW,
    ),
  };
}

for (const role of ["tenant_owner", "tenant_admin"] as const) {
  test(`${role} may invite a tenant administrator when the permission is present`, async () => {
    const { calls, transactionContexts, useCase } = createHarness();

    const result = await useCase.execute({
      authorization: authorization(role),
      hostname: "Acme.Booking.Test.",
      email: " Admin@Example.COM ",
      requestId: "request-1",
    });

    assert.deepEqual(result, { accepted: true });
    assert.deepEqual(calls, [
      {
        actorUserId: ACTOR_ID,
        tenantId: TENANT_ID,
        hostname: "acme.booking.test",
        normalizedEmail: "admin@example.com",
        displayEmail: "Admin@Example.COM",
        requestId: "request-1",
        now: NOW,
      },
    ]);
    assert.equal(Object.hasOwn(result, "userExists"), false);
    assert.equal(Object.hasOwn(result, "invitationId"), false);
    assert.equal(transactionContexts.length, 1);
    assert.deepEqual(transactionContexts[0], {
      tenantId: TENANT_ID,
      actorId: ACTOR_ID,
      sessionId: authorization(role).sessionId,
      authorization: authorization(role),
      requestId: "request-1",
      traceId: "request-1",
      source: "console",
    });
  });
}

test("denies invitation when tenant admin invite permission is absent", async () => {
  const { calls, useCase } = createHarness();

  await assert.rejects(
    useCase.execute({
      authorization: authorization("tenant_admin", false),
      hostname: "acme.booking.test",
      email: "admin@example.com",
      requestId: "request-2",
    }),
    (error: unknown) => error instanceof RoleGrantNotAllowedError,
  );
  assert.equal(calls.length, 0);
});

test("denies platform scope even when an invite permission is forged", async () => {
  const { calls, useCase } = createHarness();
  const forged: AuthorizationContext = {
    ...authorization("tenant_owner"),
    scope: { type: "platform" },
  };

  await assert.rejects(
    useCase.execute({
      authorization: forged,
      hostname: "platform.booking.test",
      email: "admin@example.com",
      requestId: "request-3",
    }),
    (error: unknown) => error instanceof RoleGrantNotAllowedError,
  );
  assert.equal(calls.length, 0);
});

test("does not invoke the invitation workflow when tenant authority became stale", async () => {
  const { calls, useCase } = createHarness(new TenantAuthorizationStaleError());

  await assert.rejects(
    useCase.execute({
      authorization: authorization("tenant_owner"),
      hostname: "acme.booking.test",
      email: "admin@example.com",
      requestId: "request-stale",
    }),
    TenantAuthorizationStaleError,
  );
  assert.equal(calls.length, 0);
});
