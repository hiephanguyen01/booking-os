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

const NOW = new Date("2026-08-07T15:45:00.000Z");
const EXPIRES_AT = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
const TENANT_ID = "30000000-0000-4000-8000-000000000101";
const OWNER_USER_ID = "60000000-0000-4000-8000-000000000101";
const OWNER_MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000101";
const OWNER_INVITATION_ID = "50000000-0000-4000-8000-000000000101";
const INVITATION_EVENT_ID = "70000000-0000-4000-8000-000000000101";
const ACTIVATION_EVENT_ID = "70000000-0000-4000-8000-000000000102";
const INVITATION_SELECTOR = "owner-invitation-selector";
const INVITATION_TOKEN_HASH = "b".repeat(64);
const RAW_INVITATION_TOKEN = "raw-owner-invitation-token";
const ACTIVATION_SELECTOR = "owner-activation-selector";
const ACTIVATION_TOKEN_HASH = "c".repeat(64);
const RAW_ACTIVATION_TOKEN = "raw-owner-activation-token";
const SEALED_INVITATION = Object.freeze({
  version: 1 as const,
  keyId: "membership-invitation-key",
  iv: "invitation-iv",
  ciphertext: "invitation-ciphertext",
  tag: "invitation-tag",
});
const SEALED_ACTIVATION = Object.freeze({
  version: 1 as const,
  keyId: "identity-activation-key",
  iv: "activation-iv",
  ciphertext: "activation-ciphertext",
  tag: "activation-tag",
});

interface DesiredPendingActivationDependencies {
  readonly activationTokens: {
    issue(input: {
      readonly tenantId: string;
      readonly hostname: string;
    }): {
      readonly selector: string;
      readonly serialized: string;
      readonly tokenHash: string;
    };
  };
  readonly activationEnvelope: {
    seal(input: {
      readonly eventId: string;
      readonly tenantId: string;
      readonly invitationId: string;
      readonly userId: string;
      readonly hostname: string;
      readonly recipient: string;
      readonly serializedToken: string;
    }): typeof SEALED_ACTIVATION;
  };
}

const INPUT: ProvisionPlatformTenantInput = Object.freeze({
  actorUserId: "10000000-0000-4000-8000-000000000101",
  idempotencyKey: "create-tenant-new-owner-20260807",
  requestHash: "a".repeat(64),
  slug: "new-owner-studio",
  tenantName: "New Owner Studio",
  ownerEmail: "New.Owner@Example.COM",
  normalizedOwnerEmail: "new.owner@example.com",
  tenantHostname: "new-owner-studio.booking.test",
  requestId: "request-new-owner",
  now: NOW,
});

test("uses a distinct activation token and encrypted activation outbox for a pending owner", async () => {
  const calls: string[] = [];
  const expectedResult: ProvisionPlatformTenantResult = Object.freeze({
    tenantId: TENANT_ID,
    slug: INPUT.slug,
    status: "provisioning",
    ownerMembershipId: OWNER_MEMBERSHIP_ID,
    ownerInvitationId: OWNER_INVITATION_ID,
    replayed: false,
  });

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
        assert.equal(input.selector, INVITATION_SELECTOR);
        assert.equal(input.tokenHash, INVITATION_TOKEN_HASH);
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
          expiresAt: EXPIRES_AT,
          acceptedAt: null,
          revokedAt: null,
          invitedByUserId: INPUT.actorUserId,
          createdAt: NOW,
          updatedAt: NOW,
        };
      },
    },
    roles: Object.freeze({}),
    outbox: {
      async append(input: Record<string, unknown>) {
        const serialized = JSON.stringify(input);
        assert.equal(serialized.includes(RAW_INVITATION_TOKEN), false);
        assert.equal(serialized.includes(RAW_ACTIVATION_TOKEN), false);

        if (input.type === "membership.owner_invitation.requested.v1") {
          calls.push("outbox:invitation");
          assert.deepEqual(input, {
            id: INVITATION_EVENT_ID,
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
          return;
        }

        if (input.type === "identity.activation.requested.v1") {
          calls.push("outbox:activation");
          assert.deepEqual(input, {
            id: ACTIVATION_EVENT_ID,
            type: "identity.activation.requested.v1",
            aggregateType: "user",
            aggregateId: OWNER_USER_ID,
            payload: {
              version: 1,
              recipient: INPUT.normalizedOwnerEmail,
              template: "account_activation",
              hostname: INPUT.tenantHostname,
              envelope: SEALED_ACTIVATION,
            },
            occurredAt: NOW,
          });
          return;
        }

        throw new Error(`Unexpected outbox event: ${String(input.type)}`);
      },
    },
    audit: {
      async append() {
        calls.push("audit:append");
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
        result: expectedResult,
        completedAt: NOW,
      });
    },
  };

  const transaction: PlatformTenantProvisioningTransactionPort = {
    async run(work) {
      return work({
        idempotency,
        identity: {
          async findOrCreatePendingIdentity() {
            calls.push("identity:resolve");
            return { userId: OWNER_USER_ID, status: "pending_activation", created: true };
          },
          async issueTenantActivation(input) {
            calls.push("identity:activation");
            assert.deepEqual(input, {
              userId: OWNER_USER_ID,
              tenantId: TENANT_ID,
              invitationId: OWNER_INVITATION_ID,
              hostname: INPUT.tenantHostname,
              selector: ACTIVATION_SELECTOR,
              tokenHash: ACTIVATION_TOKEN_HASH,
              expiresAt: EXPIRES_AT,
              now: NOW,
            });
            assert.notEqual(input.selector, INVITATION_SELECTOR);
            assert.notEqual(input.tokenHash, INVITATION_TOKEN_HASH);
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

  const eventIds = [INVITATION_EVENT_ID, ACTIVATION_EVENT_ID];
  const dependencies = {
    createTenantId: () => TENANT_ID,
    createOutboxEventId: () => {
      const id = eventIds.shift();
      if (!id) {
        throw new Error("Unexpected extra outbox event ID request.");
      }
      return id;
    },
    invitationTokens: {
      issue() {
        calls.push("invitation:token");
        return {
          selector: INVITATION_SELECTOR,
          serialized: RAW_INVITATION_TOKEN,
          tokenHash: INVITATION_TOKEN_HASH,
        };
      },
    },
    invitationEnvelope: {
      seal() {
        calls.push("invitation:seal");
        return SEALED_INVITATION;
      },
    },
    activationTokens: {
      issue(input) {
        calls.push("activation:token");
        assert.deepEqual(input, {
          tenantId: TENANT_ID,
          hostname: INPUT.tenantHostname,
        });
        return {
          selector: ACTIVATION_SELECTOR,
          serialized: RAW_ACTIVATION_TOKEN,
          tokenHash: ACTIVATION_TOKEN_HASH,
        };
      },
    },
    activationEnvelope: {
      seal(input) {
        calls.push("activation:seal");
        assert.deepEqual(input, {
          eventId: ACTIVATION_EVENT_ID,
          tenantId: TENANT_ID,
          invitationId: OWNER_INVITATION_ID,
          userId: OWNER_USER_ID,
          hostname: INPUT.tenantHostname,
          recipient: INPUT.normalizedOwnerEmail,
          serializedToken: RAW_ACTIVATION_TOKEN,
        });
        return SEALED_ACTIVATION;
      },
    },
  } satisfies PlatformTenantProvisioningWorkflowDependencies & DesiredPendingActivationDependencies;

  const workflow = new PlatformTenantProvisioningWorkflow(transaction, dependencies);
  const result = await workflow.provision(INPUT);

  assert.deepEqual(result, expectedResult);
  assert.deepEqual(calls, [
    "idempotency:claim",
    "identity:resolve",
    "invitation:token",
    "activation:token",
    "tenant:scope",
    "tenant:create",
    "tenant:domain",
    "membership:create",
    "invitation:create",
    "invitation:seal",
    "outbox:invitation",
    "activation:seal",
    "outbox:activation",
    "audit:append",
    "identity:activation",
    "idempotency:complete",
  ]);
});
