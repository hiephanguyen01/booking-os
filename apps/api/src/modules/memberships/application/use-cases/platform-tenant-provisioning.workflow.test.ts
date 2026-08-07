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
import {
  PlatformTenantProvisioningWorkflow,
  type PlatformTenantProvisioningWorkflowDependencies,
} from "./platform-tenant-provisioning.workflow.js";

const NOW = new Date("2026-08-07T13:45:00.000Z");
const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const OWNER_USER_ID = "60000000-0000-4000-8000-000000000001";
const OWNER_MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000001";
const OWNER_INVITATION_ID = "50000000-0000-4000-8000-000000000001";
const OUTBOX_EVENT_ID = "70000000-0000-4000-8000-000000000001";
const INVITATION_SELECTOR = "owner-invitation-selector";
const INVITATION_TOKEN_HASH = "b".repeat(64);
const RAW_INVITATION_TOKEN = "raw-owner-invitation-token";
const SEALED_INVITATION = Object.freeze({
  version: 1 as const,
  keyId: "membership-invitation-key",
  iv: "sealed-iv",
  ciphertext: "sealed-ciphertext",
  tag: "sealed-tag",
});

interface DesiredOutboxDependencies {
  readonly createOutboxEventId: () => string;
  readonly invitationEnvelope: {
    seal(input: {
      readonly eventId: string;
      readonly tenantId: string;
      readonly invitationId: string;
      readonly userId: string;
      readonly hostname: string;
      readonly normalizedEmail: string;
      readonly intendedRoleKey: "tenant_owner";
      readonly serializedToken: string;
    }): typeof SEALED_INVITATION;
  };
}

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
      async append(input: Record<string, unknown>) {
        calls.push("outbox:append");
        assert.deepEqual(input, {
          id: OUTBOX_EVENT_ID,
          type: "membership.owner_invitation.requested.v1",
          aggregateType: "membership_invitation",
          aggregateId: OWNER_INVITATION_ID,
          payload: {
            version: 1,
            recipient: INPUT.normalizedOwnerEmail,
            hostname: INPUT.tenantHostname,
            purpose: "membership_invitation",
            envelope: SEALED_INVITATION,
          },
          occurredAt: NOW,
        });
        assert.equal(JSON.stringify(input).includes(RAW_INVITATION_TOKEN), false);
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

  const dependencies = {
    createTenantId: () => TENANT_ID,
    createOutboxEventId: () => OUTBOX_EVENT_ID,
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
          serialized: RAW_INVITATION_TOKEN,
          tokenHash: INVITATION_TOKEN_HASH,
        };
      },
    },
    invitationEnvelope: {
      seal(input) {
        calls.push("invitation:seal");
        assert.deepEqual(input, {
          eventId: OUTBOX_EVENT_ID,
          tenantId: TENANT_ID,
          invitationId: OWNER_INVITATION_ID,
          userId: OWNER_USER_ID,
          hostname: INPUT.tenantHostname,
          normalizedEmail: INPUT.normalizedOwnerEmail,
          intendedRoleKey: "tenant_owner",
          serializedToken: RAW_INVITATION_TOKEN,
        });
        return SEALED_INVITATION;
      },
    },
  } satisfies PlatformTenantProvisioningWorkflowDependencies & DesiredOutboxDependencies;
  const workflow = new PlatformTenantProvisioningWorkflow(transaction, dependencies);

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
    "invitation:seal",
    "outbox:append",
    "audit:append",
    "idempotency:complete",
  ]);
});

test("replaces a pending owner invitation and persists the same activation token that was delivered", async () => {
  const calls: string[] = [];
  const replacementId = "50000000-0000-4000-8000-000000000099";
  const activation = {
    selector: "activation-selector",
    serialized: "activation-secret",
    tokenHash: "d".repeat(64),
  };
  const transaction: PlatformTenantProvisioningTransactionPort = {
    async run(work) {
      return work({
        idempotency: {} as TenantProvisioningIdempotencyPort,
        identity: {
          async findOrCreatePendingIdentity() {
            return { userId: OWNER_USER_ID, status: "pending_activation", created: false };
          },
          async issueTenantActivation(input) {
            calls.push("activation:store");
            assert.equal(input.selector, activation.selector);
            assert.equal(input.tokenHash, activation.tokenHash);
            assert.equal(input.invitationId, replacementId);
          },
        },
        async runTenant<T>(
          _tenantId: string,
          tenantWork: (session: PlatformTenantProvisioningDataSession) => Promise<T>,
        ) {
          return tenantWork({
            tenants: {
              async lockCurrent() {
                return {
                  id: TENANT_ID,
                  slug: "acme",
                  name: "Acme",
                  status: "provisioning" as const,
                };
              },
            },
            invitations: {
              async lockPendingOwnerInvitation() {
                return {
                  id: OWNER_INVITATION_ID,
                  tenantId: TENANT_ID,
                  normalizedEmail: INPUT.normalizedOwnerEmail,
                  invitedUserId: OWNER_USER_ID,
                  intendedRoleKey: "tenant_owner" as const,
                  status: "pending" as const,
                  hostname: INPUT.tenantHostname,
                  selector: "old",
                  tokenHash: "a".repeat(64),
                  expiresAt: NOW,
                  acceptedAt: null,
                  revokedAt: null,
                  invitedByUserId: INPUT.actorUserId,
                  createdAt: NOW,
                  updatedAt: NOW,
                };
              },
              async revoke() {
                calls.push("invitation:revoke");
              },
              async create() {
                calls.push("invitation:create");
                return {
                  id: replacementId,
                  tenantId: TENANT_ID,
                  normalizedEmail: INPUT.normalizedOwnerEmail,
                  invitedUserId: OWNER_USER_ID,
                  intendedRoleKey: "tenant_owner" as const,
                  status: "pending" as const,
                  hostname: INPUT.tenantHostname,
                  selector: "new",
                  tokenHash: "b".repeat(64),
                  expiresAt: NOW,
                  acceptedAt: null,
                  revokedAt: null,
                  invitedByUserId: INPUT.actorUserId,
                  createdAt: NOW,
                  updatedAt: NOW,
                };
              },
            },
            outbox: {
              async append() {
                calls.push("outbox:append");
              },
            },
            audit: {
              async append() {
                calls.push("audit:append");
              },
            },
          } as unknown as PlatformTenantProvisioningDataSession);
        },
      });
    },
  };
  const workflow = new PlatformTenantProvisioningWorkflow(transaction, {
    createOutboxEventId: () => OUTBOX_EVENT_ID,
    invitationTokens: {
      issue: () => ({
        selector: "new",
        serialized: RAW_INVITATION_TOKEN,
        tokenHash: "b".repeat(64),
      }),
    },
    invitationEnvelope: { seal: () => SEALED_INVITATION },
    activationTokens: { issue: () => activation },
    activationEnvelope: { seal: () => SEALED_INVITATION },
  });

  const result = await workflow.resendOwnerInvitation({
    actorUserId: INPUT.actorUserId,
    tenantId: TENANT_ID,
    requestId: INPUT.requestId,
    now: NOW,
  });

  assert.deepEqual(result, { accepted: true });
  assert.deepEqual(calls, [
    "invitation:revoke",
    "invitation:create",
    "outbox:append",
    "outbox:append",
    "audit:append",
    "activation:store",
  ]);
});
