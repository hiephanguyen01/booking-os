import assert from "node:assert/strict";
import test from "node:test";

import { InvitationInvalidOrExpiredError } from "../../domain/membership-errors.js";
import { ResolvePendingInvitationLoginUseCase } from "./resolve-pending-invitation-login.use-case.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000009";

function createHarness() {
  const calls: unknown[] = [];
  let error: Error | null = null;
  const currentInvitation = {
    async execute(input: unknown) {
      calls.push(input);
      if (error) throw error;
      return {
        invitationId: "50000000-0000-4000-8000-000000000001",
        tenantId: TENANT_ID,
        intendedRoleKey: "tenant_admin" as const,
        hostname: "acme.booking.test",
        expiresAt: new Date("2026-08-09T01:30:00.000Z"),
      };
    },
  };
  return {
    calls,
    setError(value: Error | null) {
      error = value;
    },
    useCase: new ResolvePendingInvitationLoginUseCase(currentInvitation),
  };
}

test("allows pending login only when a current invitation exists for the tenant user and hostname", async () => {
  const harness = createHarness();

  const result = await harness.useCase.execute({
    tenantId: TENANT_ID,
    userId: USER_ID,
    hostname: "acme.booking.test",
  });

  assert.equal(result, true);
  assert.deepEqual(harness.calls, [
    { tenantId: TENANT_ID, userId: USER_ID, hostname: "acme.booking.test" },
  ]);
});

test("maps invalid, expired, revoked, or wrong-host invitation state to ineligible", async () => {
  const harness = createHarness();
  harness.setError(new InvitationInvalidOrExpiredError());

  const result = await harness.useCase.execute({
    tenantId: TENANT_ID,
    userId: USER_ID,
    hostname: "wrong.booking.test",
  });

  assert.equal(result, false);
});

test("does not hide unexpected membership failures", async () => {
  const harness = createHarness();
  const failure = new Error("transaction unavailable");
  harness.setError(failure);

  await assert.rejects(
    harness.useCase.execute({
      tenantId: TENANT_ID,
      userId: USER_ID,
      hostname: "acme.booking.test",
    }),
    (error: unknown) => error === failure,
  );
});
