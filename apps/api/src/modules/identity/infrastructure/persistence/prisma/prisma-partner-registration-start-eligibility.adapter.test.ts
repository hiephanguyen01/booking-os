import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPartnerRegistrationStartEligibilityAdapter } from "./prisma-partner-registration-start-eligibility.adapter.js";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000001";

function createTransaction(input: {
  readonly user: { readonly id: string; readonly status: string } | null;
  readonly membership?: { readonly id: string; readonly status: string } | null;
}) {
  const calls: unknown[] = [];
  return {
    calls,
    transaction: {
      user: {
        async findUnique(query: unknown) {
          calls.push(["user.findUnique", query]);
          return input.user;
        },
      },
      tenantMembership: {
        async findUnique(query: unknown) {
          calls.push(["tenantMembership.findUnique", query]);
          return input.membership ?? null;
        },
      },
    },
  };
}

test("registration start eligibility allows a new identity without probing memberships", async () => {
  const harness = createTransaction({ user: null });
  const adapter = new PrismaPartnerRegistrationStartEligibilityAdapter(
    harness.transaction as never,
    TENANT_ID,
  );

  assert.deepEqual(await adapter.classifyStart({ normalizedEmail: "new@example.test" }), {
    eligible: true,
    tenantMembershipId: null,
  });
  assert.deepEqual(harness.calls, [
    [
      "user.findUnique",
      {
        where: { normalizedEmail: "new@example.test" },
        select: { id: true, status: true },
      },
    ],
  ]);
});

test("registration start eligibility suppresses suspended and disabled identities", async () => {
  for (const status of ["suspended", "disabled"] as const) {
    const harness = createTransaction({ user: { id: USER_ID, status } });
    const adapter = new PrismaPartnerRegistrationStartEligibilityAdapter(
      harness.transaction as never,
      TENANT_ID,
    );

    assert.deepEqual(await adapter.classifyStart({ normalizedEmail: "blocked@example.test" }), {
      eligible: false,
      reason: "identity_unavailable",
    });
    assert.equal(harness.calls.length, 1);
  }
});

test("registration start eligibility permits active or pending identities with absent, invited, or active membership", async () => {
  const cases = [
    { userStatus: "active", membership: null, expectedMembershipId: null },
    {
      userStatus: "pendingActivation",
      membership: { id: MEMBERSHIP_ID, status: "invited" },
      expectedMembershipId: MEMBERSHIP_ID,
    },
    {
      userStatus: "active",
      membership: { id: MEMBERSHIP_ID, status: "active" },
      expectedMembershipId: MEMBERSHIP_ID,
    },
  ] as const;

  for (const entry of cases) {
    const harness = createTransaction({
      user: { id: USER_ID, status: entry.userStatus },
      membership: entry.membership,
    });
    const adapter = new PrismaPartnerRegistrationStartEligibilityAdapter(
      harness.transaction as never,
      TENANT_ID,
    );

    assert.deepEqual(await adapter.classifyStart({ normalizedEmail: "eligible@example.test" }), {
      eligible: true,
      tenantMembershipId: entry.expectedMembershipId,
    });
    assert.deepEqual(harness.calls[1], [
      "tenantMembership.findUnique",
      {
        where: { tenantId_userId: { tenantId: TENANT_ID, userId: USER_ID } },
        select: { id: true, status: true },
      },
    ]);
  }
});

test("registration start eligibility suppresses suspended or revoked tenant memberships", async () => {
  for (const status of ["suspended", "revoked"] as const) {
    const harness = createTransaction({
      user: { id: USER_ID, status: "active" },
      membership: { id: MEMBERSHIP_ID, status },
    });
    const adapter = new PrismaPartnerRegistrationStartEligibilityAdapter(
      harness.transaction as never,
      TENANT_ID,
    );

    assert.deepEqual(await adapter.classifyStart({ normalizedEmail: "member@example.test" }), {
      eligible: false,
      reason: "tenant_membership_unavailable",
    });
  }
});
