import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";

import { RoleGrantNotAllowedError } from "../../domain/membership-errors.js";
import { ResendInvitationUseCase } from "./resend-invitation.use-case.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const INVITATION_ID = "50000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-08T01:15:00.000Z");

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
    async inviteTenantAdmin() {
      throw new Error("not used");
    },
    async resendInvitation(input: unknown) {
      calls.push(input);
      return Object.freeze({ accepted: true as const });
    },
    async getCurrentInvitation() {
      throw new Error("not used");
    },
  };
  return { calls, useCase: new ResendInvitationUseCase(workflow, () => NOW) };
}

for (const role of ["tenant_owner", "tenant_admin"] as const) {
  test(`${role} may resend a tenant-admin invitation`, async () => {
    const { calls, useCase } = createHarness();

    const result = await useCase.execute({
      authorization: authorization(role),
      hostname: "Acme.Booking.Test.",
      invitationId: INVITATION_ID,
      requestId: "request-resend",
    });

    assert.deepEqual(result, { accepted: true });
    assert.deepEqual(calls, [
      {
        actorUserId: ACTOR_ID,
        tenantId: TENANT_ID,
        hostname: "acme.booking.test",
        invitationId: INVITATION_ID,
        requestId: "request-resend",
        now: NOW,
      },
    ]);
  });
}

test("resend is denied without tenant admin invite permission", async () => {
  const { calls, useCase } = createHarness();

  await assert.rejects(
    useCase.execute({
      authorization: authorization("tenant_admin", false),
      hostname: "acme.booking.test",
      invitationId: INVITATION_ID,
      requestId: "request-denied",
    }),
    (error: unknown) => error instanceof RoleGrantNotAllowedError,
  );
  assert.equal(calls.length, 0);
});
