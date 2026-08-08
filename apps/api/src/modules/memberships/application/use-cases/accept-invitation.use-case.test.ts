import assert from "node:assert/strict";
import test from "node:test";

import type { TenantExecutionContext } from "@booking-os/contracts";
import type {
  TenantDataSession,
  TenantTransactionPort,
} from "../../../tenancy/application/ports/tenant-transaction.port.js";
import type { MembershipInvitation } from "../../domain/membership-invitation.js";
import type { TenantMembership } from "../../domain/tenant-membership.js";
import type { SessionElevationPort } from "../ports/session-elevation.port.js";
import { AcceptInvitationUseCase } from "./accept-invitation.use-case.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000009";
const MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000001";
const INVITATION_ID = "50000000-0000-4000-8000-000000000001";
const SESSION_ID = "60000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-08T12:30:00.000Z");
const HOSTNAME = "acme.booking.test";
const SERIALIZED_TOKEN = "selector.secret";

const invitation: MembershipInvitation = Object.freeze({
  id: INVITATION_ID,
  tenantId: TENANT_ID,
  normalizedEmail: "owner@example.test",
  invitedUserId: USER_ID,
  intendedRoleKey: "tenant_owner",
  status: "pending",
  hostname: HOSTNAME,
  selector: "selector",
  tokenHash: "stored-digest",
  expiresAt: new Date("2026-08-09T12:30:00.000Z"),
  acceptedAt: null,
  revokedAt: null,
  invitedByUserId: "10000000-0000-4000-8000-000000000001",
  createdAt: new Date("2026-08-08T11:30:00.000Z"),
  updatedAt: new Date("2026-08-08T11:30:00.000Z"),
});

const invitedMembership: TenantMembership = Object.freeze({
  id: MEMBERSHIP_ID,
  tenantId: TENANT_ID,
  userId: USER_ID,
  status: "invited",
  authorizationVersion: 0,
  acceptedAt: null,
  suspendedAt: null,
  revokedAt: null,
  createdAt: new Date("2026-08-08T11:30:00.000Z"),
  updatedAt: new Date("2026-08-08T11:30:00.000Z"),
});

function createHarness() {
  const events: string[] = [];
  const transactionContexts: TenantExecutionContext[] = [];
  let insideTransaction = false;

  function transactional<T>(event: string, value: T): Promise<T> {
    assert.equal(insideTransaction, true, `${event} must execute inside the tenant transaction`);
    events.push(event);
    return Promise.resolve(value);
  }

  const sessionElevation: SessionElevationPort = {
    elevateInvitationSession: async (input) => {
      assert.deepEqual(input, {
        sessionId: SESSION_ID,
        membershipAuthorizationVersion: 1,
        now: NOW,
      });
      return transactional("session.elevate", {
        sessionId: SESSION_ID,
        rotatedToken: "rotated-selector.rotated-secret",
      });
    },
  };

  const session = {
    invitations: {
      lockBySelector: async (selector: string) => {
        assert.equal(selector, "selector");
        return transactional("invitation.lock", invitation);
      },
      accept: async (id: string, now: Date) => {
        assert.equal(id, INVITATION_ID);
        assert.equal(now, NOW);
        await transactional("invitation.accept", undefined);
      },
    },
    memberships: {
      findByUserId: async (userId: string) => {
        assert.equal(userId, USER_ID);
        return transactional("membership.find", invitedMembership);
      },
      lockById: async (id: string) => {
        assert.equal(id, MEMBERSHIP_ID);
        return transactional("membership.lock", invitedMembership);
      },
      activate: async (id: string, now: Date) => {
        assert.equal(id, MEMBERSHIP_ID);
        assert.equal(now, NOW);
        return transactional("membership.activate", {
          ...invitedMembership,
          status: "active" as const,
          acceptedAt: NOW,
          updatedAt: NOW,
        });
      },
      incrementAuthorizationVersion: async (id: string, now: Date) => {
        assert.equal(id, MEMBERSHIP_ID);
        assert.equal(now, NOW);
        return transactional("membership.version", 1);
      },
    },
    roles: {
      assign: async (input: unknown) => {
        assert.deepEqual(input, { userId: USER_ID, roleKey: "tenant_owner", now: NOW });
        await transactional("role.assign", undefined);
      },
    },
    tenants: {
      lockCurrent: async () =>
        transactional("tenant.lock", {
          id: TENANT_ID,
          slug: "acme",
          name: "Acme",
          status: "provisioning" as const,
        }),
      activate: async (now: Date) => {
        assert.equal(now, NOW);
        await transactional("tenant.activate", undefined);
      },
    },
    audit: {
      append: async (input: unknown) => {
        assert.deepEqual(input, {
          eventType: "membership.invitation.accepted",
          actorUserId: USER_ID,
          subjectUserId: USER_ID,
          requestId: "request-accept-invitation",
          metadata: {
            membershipId: MEMBERSHIP_ID,
            invitationId: INVITATION_ID,
            intendedRoleKey: "tenant_owner",
          },
          occurredAt: NOW,
        });
        await transactional("audit.append", undefined);
      },
    },
    sessions: sessionElevation,
  } as unknown as TenantDataSession & { readonly sessions: SessionElevationPort };

  const transactions: TenantTransactionPort = {
    async run(context, work) {
      transactionContexts.push(context);
      assert.equal(insideTransaction, false);
      insideTransaction = true;
      try {
        return await work(session);
      } finally {
        insideTransaction = false;
      }
    },
  };

  const tokenCalls: unknown[] = [];
  const tokens = {
    parse(serialized: string) {
      assert.equal(serialized, SERIALIZED_TOKEN);
      return { selector: "selector", secret: "secret" };
    },
    verify(input: unknown) {
      tokenCalls.push(input);
      return true;
    },
  };

  return {
    events,
    tokenCalls,
    transactionContexts,
    useCase: new AcceptInvitationUseCase(transactions, tokens, () => NOW),
  };
}

test("accepts a bound owner invitation and elevates the pending session atomically", async () => {
  const harness = createHarness();

  const result = await harness.useCase.execute({
    tenantId: TENANT_ID,
    userId: USER_ID,
    sessionId: SESSION_ID,
    hostname: HOSTNAME,
    token: SERIALIZED_TOKEN,
    requestId: "request-accept-invitation",
  });

  assert.deepEqual(harness.transactionContexts, [
    {
      tenantId: TENANT_ID,
      actorId: USER_ID,
      requestId: "request-accept-invitation",
      traceId: "request-accept-invitation",
      source: "console",
    },
  ]);
  assert.deepEqual(harness.tokenCalls, [
    {
      secret: "secret",
      expectedTokenHash: "stored-digest",
      tenantId: TENANT_ID,
      userId: USER_ID,
      hostname: HOSTNAME,
      normalizedEmail: "owner@example.test",
      intendedRoleKey: "tenant_owner",
    },
  ]);
  assert.deepEqual(harness.events, [
    "invitation.lock",
    "membership.find",
    "membership.lock",
    "membership.activate",
    "role.assign",
    "membership.version",
    "tenant.lock",
    "tenant.activate",
    "invitation.accept",
    "session.elevate",
    "audit.append",
  ]);
  assert.deepEqual(result, {
    accepted: true,
    rotatedSessionToken: "rotated-selector.rotated-secret",
  });
});
