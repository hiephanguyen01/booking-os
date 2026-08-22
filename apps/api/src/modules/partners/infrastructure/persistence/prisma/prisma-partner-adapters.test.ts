import assert from "node:assert/strict";
import test from "node:test";

import { PrismaPartnerAuthorizationQueryAdapter } from "./prisma-partner-authorization-query.adapter.js";
import { PrismaPartnerRepositoryAdapter } from "./prisma-partner-repository.adapter.js";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const PARTNER_ID = "20000000-0000-4000-8000-000000000001";
const TENANT_MEMBERSHIP_ID = "30000000-0000-4000-8000-000000000001";
const PARTNER_MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000001";
const USER_ID = "50000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-22T00:00:00.000Z");

function createPartnerRow() {
  return {
    id: PARTNER_ID,
    tenantId: TENANT_ID,
    type: "individual",
    applicationStatus: "changesRequested",
    operationalStatus: "inactive",
    authorizationVersion: 3,
    version: 7,
    submittedAt: null,
    approvedAt: null,
    suspendedAt: null,
    cancelledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  } as const;
}

test("partner repository scopes root and membership reads to the established tenant", async () => {
  const events: unknown[] = [];
  const transaction = {
    partner: {
      async findFirst(input: unknown) {
        events.push(["partner.findFirst", input]);
        return createPartnerRow();
      },
    },
    partnerMembership: {
      async findFirst(input: unknown) {
        events.push(["partnerMembership.findFirst", input]);
        return {
          id: PARTNER_MEMBERSHIP_ID,
          tenantId: TENANT_ID,
          partnerId: PARTNER_ID,
          tenantMembershipId: TENANT_MEMBERSHIP_ID,
          status: "active",
          authorizationVersion: 5,
          suspendedAt: null,
          revokedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        };
      },
    },
  };

  const repository = new PrismaPartnerRepositoryAdapter(transaction as never, TENANT_ID);

  const partner = await repository.findById(PARTNER_ID);
  const membership = await repository.findMembership(PARTNER_ID, TENANT_MEMBERSHIP_ID);

  assert.deepEqual(events[0], [
    "partner.findFirst",
    { where: { id: PARTNER_ID, tenantId: TENANT_ID } },
  ]);
  assert.deepEqual(events[1], [
    "partnerMembership.findFirst",
    {
      where: {
        partnerId: PARTNER_ID,
        tenantMembershipId: TENANT_MEMBERSHIP_ID,
        tenantId: TENANT_ID,
      },
    },
  ]);
  assert.equal(partner?.applicationStatus, "changes_requested");
  assert.equal(membership?.tenantId, TENANT_ID);
});

test("partner authorization returns only a closed active Partner authority snapshot", async () => {
  let rows: readonly unknown[] = [
    {
      partnerId: PARTNER_ID,
      partnerAuthorizationVersion: 3,
      partnerMembershipId: PARTNER_MEMBERSHIP_ID,
      partnerMembershipAuthorizationVersion: 5,
      roleKeys: ["partner_owner"],
      permissionKeys: ["partner.profile.read", "partner.application.submit"],
    },
  ];
  const calls: unknown[] = [];
  const transaction = {
    async $queryRawUnsafe(statement: string, ...values: unknown[]) {
      calls.push([statement, values]);
      return rows;
    },
  };
  const query = new PrismaPartnerAuthorizationQueryAdapter(transaction as never, TENANT_ID);

  const snapshot = await query.loadForUser(PARTNER_ID, USER_ID);

  assert.deepEqual(snapshot, {
    partnerId: PARTNER_ID,
    partnerAuthorizationVersion: 3,
    partnerMembershipId: PARTNER_MEMBERSHIP_ID,
    partnerMembershipAuthorizationVersion: 5,
    roleKeys: ["partner_owner"],
    permissions: ["partner.application.submit", "partner.profile.read"],
  });
  assert.deepEqual((calls[0] as readonly unknown[])[1], [TENANT_ID, PARTNER_ID, USER_ID]);

  rows = [
    {
      partnerId: PARTNER_ID,
      partnerAuthorizationVersion: 3,
      partnerMembershipId: PARTNER_MEMBERSHIP_ID,
      partnerMembershipAuthorizationVersion: 5,
      roleKeys: ["partner_owner", "unknown_partner_role"],
      permissionKeys: ["partner.profile.read"],
    },
  ];

  assert.equal(await query.loadForUser(PARTNER_ID, USER_ID), null);
});
