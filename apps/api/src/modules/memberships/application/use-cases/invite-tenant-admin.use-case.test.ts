import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import { RoleGrantNotAllowedError } from "../../domain/membership-errors.js";
import { InviteTenantAdminUseCase } from "./invite-tenant-admin.use-case.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-08T01:00:00.000Z");

function authorization(role: "tenant_owner" | "tenant_admin", withPermission = true): AuthorizationContext {
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

function createHarness() {
  const calls: unknown[] = [];
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
    useCase: new InviteTenantAdminUseCase(workflow, () => NOW),
  };
}

for (const role of ["tenant_owner", "tenant_admin"] as const) {
  test(`${role} may invite a tenant administrator when the permission is present`, async () => {
    const { calls, useCase } = createHarness();

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
