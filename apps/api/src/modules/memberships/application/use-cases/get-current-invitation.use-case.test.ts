import assert from "node:assert/strict";
import test from "node:test";

import { InvitationInvalidOrExpiredError } from "../../domain/membership-errors.js";
import type { CurrentInvitationWorkflowResult } from "../ports/tenant-admin-invitation-workflow.port.js";
import { GetCurrentInvitationUseCase } from "./get-current-invitation.use-case.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000009";
const NOW = new Date("2026-08-08T01:30:00.000Z");
const EXPIRES_AT = new Date("2026-08-09T01:30:00.000Z");

function createHarness(current: CurrentInvitationWorkflowResult | null) {
  const calls: unknown[] = [];
  const workflow = {
    async inviteTenantAdmin() {
      throw new Error("not used");
    },
    async resendInvitation() {
      throw new Error("not used");
    },
    async getCurrentInvitation(input: unknown) {
      calls.push(input);
      return current;
    },
  };
  return { calls, useCase: new GetCurrentInvitationUseCase(workflow, () => NOW) };
}

test("returns safe current invitation metadata", async () => {
  const { calls, useCase } = createHarness({
    id: "50000000-0000-4000-8000-000000000001",
    tenantId: TENANT_ID,
    invitedUserId: USER_ID,
    intendedRoleKey: "tenant_admin",
    hostname: "acme.booking.test",
    expiresAt: EXPIRES_AT,
  });

  const result = await useCase.execute({
    tenantId: TENANT_ID,
    userId: USER_ID,
    hostname: "Acme.Booking.Test.",
  });

  assert.deepEqual(calls, [
    { tenantId: TENANT_ID, userId: USER_ID, hostname: "acme.booking.test", now: NOW },
  ]);
  assert.deepEqual(result, {
    invitationId: "50000000-0000-4000-8000-000000000001",
    tenantId: TENANT_ID,
    intendedRoleKey: "tenant_admin",
    hostname: "acme.booking.test",
    expiresAt: EXPIRES_AT,
  });
});

test("rejects an unavailable current invitation", async () => {
  const { useCase } = createHarness(null);
  await assert.rejects(
    useCase.execute({ tenantId: TENANT_ID, userId: USER_ID, hostname: "acme.booking.test" }),
    (error: unknown) => error instanceof InvitationInvalidOrExpiredError,
  );
});
