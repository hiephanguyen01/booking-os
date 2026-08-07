import assert from "node:assert/strict";
import test from "node:test";

import type {
  PlatformTenantProvisioningDataSession,
  PlatformTenantProvisioningTransactionPort,
} from "../ports/platform-tenant-provisioning-transaction.port.js";
import type {
  ProvisionPlatformTenantInput,
  ProvisionPlatformTenantResult,
} from "../ports/platform-tenant-provisioning-workflow.port.js";
import type { TenantProvisioningIdempotencyPort } from "../ports/tenant-provisioning-idempotency.port.js";
import { PlatformTenantProvisioningWorkflow } from "./platform-tenant-provisioning.workflow.js";

const NOW = new Date("2026-08-07T13:45:00.000Z");
const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const OWNER_USER_ID = "60000000-0000-4000-8000-000000000001";
const OWNER_MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000001";
const OWNER_INVITATION_ID = "50000000-0000-4000-8000-000000000001";
const INVITATION_SELECTOR = "owner-invitation-selector";
const INVITATION_TOKEN_HASH = "b".repeat(64);

const INPUT: ProvisionPlatformTenantInput = Object.freeze({
  actorUserId: "10000000-0000-4000-8000-000000000001",
  idempotencyKey: "create-tenant-acme-20260807",
  requestHash: "a".repeat(64),
  slug: "acme",
  tenantName: "Acme Ltd",
  ownerEmail: "Owner@Example.COM",
  normalizedOwnerEmail: "owner@example.com",
  tenantHostname: "acme.booking.test",
  requestId: "request-1",
  now: NOW,
});

const COMMITTED_RESULT: ProvisionPlatformTenantResult = Object.freeze({
  tenantId: TENANT_ID,
  slug: "acme",
  status: "provisioning",
  ownerMembershipId: OWNER_MEMBERSHIP_ID,
  ownerInvitationId: OWNER_INVITATION_ID,
  replayed: true,
});

test("replays a completed provisioning request without entering tenant scope", async () => {
  let identityCalls = 0;
  let runTenantCalls = 0;
  let completeCalls = 0;
  const idempotency: TenantProvisioningIdempotencyPort = {
    async claim(input) {
      assert.deepEqual(input, {
        key: INPUT.idempotencyKey,
        requestHash: INPUT.requestHash,
        actorUserId: INPUT.actorUserId,
        now: NOW,
      });
      return { status: "completed", result: COMMITTED_RESULT };
    },
    async complete() {
      completeCalls += 1;
    },
  };
  const transaction: PlatformTenantProvisioningTransactionPort = {
    async run(work) {
      return work({
        idempotency,
        identity: {
          async findOrCreatePendingIdentity() {
            identityCalls += 1;
            throw new Error("identity must not be resolved for an idempotent replay");
          },
          async issueTenantActivation() {
            identityCalls += 1;
          },
        },
        async runTenant<T>(
          _tenantId: string,
          _tenantWork: (session: PlatformTenantProvisioningDataSession) => Promise<T>,
        ): Promise<T> {
          runTenantCalls += 1;
          throw new Error("tenant scope must not be entered for an idempotent replay");
        },
      });
    },
  };
  const workflow = new PlatformTenantProvisioningWorkflow(transaction);

  const result = await workflow.provision(INPUT);

  assert.deepEqual(result, COMMITTED_RESULT);
  assert.equal(identityCalls, 0);
  assert.equal(runTenantCalls, 0);
  assert.equal(completeCalls, 0);
});

test("provisions an existing owner inside one target-tenant scope before completing idempotency", async () => {
  const calls: string[] = [];
  let roleAssignments = 0;
  let activationCalls = 0;
  const invitationExpiresAt = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  const resultWithoutReplay: ProvisionPlatformTenantResult = {
    tenantId: TENANT_ID,
    slug: INPUT.slug,
    status: "provisioning",
    ownerMembershipId: OWNER_MEMBERSHIP_ID,
    ownerInvitationId: OWNER_INVITATION_ID,
    replayed: false,
  };

  const session = {
    tenants: {
      async createProvisioning(input: { slug: string; name: string; now: Date }) {
        calls.push("tenant:create");
        assert.deepEqual(input, { slug: INPUT.slug, name: INPUT.tenantName, now: NOW });
        return {
          id: TENANT_ID,
          slug: INPUT.slug,
          name: INPUT.tenantName,
          status: "provisioning" as const,
        };
      },
      async addPrimaryDomain(hostname: string, now: Date) {
        calls.push("tenant:domain");
        assert.equal(hostname, INPUT.tenantHostname);
        assert.equal(now, NOW);
      },
    },
    memberships: {
      async createInvited(input: { userId: string; now: Date }) {
        calls.push("membership:create");
        assert.deepEqual(input, { userId: OWNER_USER_ID, now: NOW });
        return {
          id: OWNER_MEMBERSHIP_ID,
          tenantId: TENANT_ID,
          userId: OWNER_USER_ID,
          status: "invited" as const,
          authorizationVersion: 1,
          acceptedAt: null,
          suspendedAt: null,
          revokedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
        };
      },
    },
    invitations: {
      async create(input: Record<string, unknown>) {
        calls.push("invitation:create");
        assert.deepEqual(input, {
          normalizedEmail: INPUT.normalizedOwnerEmail,
          invitedUserId: OWNER_USER_ID,
          intendedRoleKey: "tenant_owner",
          hostname: INPUT.tenantHostname,
          selector: INVITATION_SELECTOR,
          tokenHash: INVITATION_TOKEN_HASH,
          expiresAt: invitationExpiresAt,
          invitedByUserId: INPUT.actorUserId,
          now: NOW,
        });
        return {
          id: OWNER_INVITATION_ID,
          tenantId: TENANT_ID,
          normalizedEmail: INPUT.normalizedOwnerEmail,
          invitedUserId: OWNER_USER_ID,
          intendedRoleKey: "tenant_owner" as const,
          status: "pending" as const,
          hostname: INPUT.tenantHostname,
          selector: INVITATION_SELECTOR,
          tokenHash: INVITATION_TOKEN_HASH,
          expiresAt: invitationExpiresAt,
          acceptedAt: null,
          revokedAt: null,
          invitedByUserId: INPUT.actorUserId,
          createdAt: NOW,
          updatedAt: NOW,
        };
      },
    },
    roles: {
      async assign() {
        roleAssignments += 1;
      },
    },
    audit: {
      async append() {
        calls.push("audit:append");
      },
    },
    outbox: {
      async append() {
        calls.push("outbox:append");
      },
    },
  } as unknown as PlatformTenantProvisioningDataSession;

  const idempotency: TenantProvisioningIdempotencyPort = {
    async claim() {
      calls.push("idempotency:claim");
      return { status: "claimed" };
    },
    async complete(input) {
      calls.push("idempotency:complete");
      assert.deepEqual(input, {
        key: INPUT.idempotencyKey,
        requestHash: INPUT.requestHash,
        result: resultWithoutReplay,
        completedAt: NOW,
      });
    },
  };

  const transaction: PlatformTenantProvisioningTransactionPort = {
    async run(work) {
      return work({
        idempotency,
        identity: {
          async findOrCreatePendingIdentity(input) {
            calls.push("identity:resolve");
            assert.deepEqual(input, {
              normalizedEmail: INPUT.normalizedOwnerEmail,
              displayEmail: INPUT.ownerEmail,
              now: NOW,
            });
            return { userId: OWNER_USER_ID, status: "active", created: false };
          },
          async issueTenantActivation() {
            activationCalls += 1;
          },
        },
        async runTenant<T>(
          tenantId: string,
          tenantWork: (tenantSession: PlatformTenantProvisioningDataSession) => Promise<T>,
        ): Promise<T> {
          calls.push("tenant:scope");
          assert.equal(tenantId, TENANT_ID);
          return tenantWork(session);
        },
      });
    },
  };

  const workflow = new PlatformTenantProvisioningWorkflow(transaction, {
    createTenantId: () => TENANT_ID,
    invitationTokens: {
      issue(input) {
        calls.push("invitation:token");
        assert.deepEqual(input, {
          tenantId: TENANT_ID,
          userId: OWNER_USER_ID,
          hostname: INPUT.tenantHostname,
          normalizedEmail: INPUT.normalizedOwnerEmail,
          intendedRoleKey: "tenant_owner",
        });
        return {
          selector: INVITATION_SELECTOR,
          serialized: "raw-owner-invitation-token",
          tokenHash: INVITATION_TOKEN_HASH,
        };
      },
    },
  });

  const result = await workflow.provision(INPUT);

  assert.deepEqual(result, resultWithoutReplay);
  assert.equal(roleAssignments, 0);
  assert.equal(activationCalls, 0);
  assert.deepEqual(calls, [
    "idempotency:claim",
    "identity:resolve",
    "invitation:token",
    "tenant:scope",
    "tenant:create",
    "tenant:domain",
    "membership:create",
    "invitation:create",
    "audit:append",
    "idempotency:complete",
  ]);
});
