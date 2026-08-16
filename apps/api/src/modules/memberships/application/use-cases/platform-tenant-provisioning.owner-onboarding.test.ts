import assert from "node:assert/strict";
import test from "node:test";

import type {
  PlatformTenantProvisioningDataSession,
  PlatformTenantProvisioningTransactionPort,
} from "../ports/platform-tenant-provisioning-transaction.port.js";
import type { TenantProvisioningIdempotencyPort } from "../ports/tenant-provisioning-idempotency.port.js";
import { PlatformTenantProvisioningWorkflow } from "./platform-tenant-provisioning.workflow.js";

const NOW = new Date("2026-08-16T12:40:00.000Z");
const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const USER_ID = "60000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000001";
const INVITATION_ID = "50000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";

const SEALED = Object.freeze({
  version: 1 as const,
  keyId: "test-key",
  iv: "iv",
  ciphertext: "ciphertext",
  tag: "tag",
});

test("pending initial owner emits one owner-onboarding email event", async () => {
  const outboxTypes: string[] = [];
  let outboxSequence = 0;

  const session = {
    tenants: {
      async createProvisioning() {
        return {
          id: TENANT_ID,
          slug: "acme",
          name: "Acme Studio",
          status: "provisioning" as const,
        };
      },
      async addPrimaryDomain() {},
    },
    memberships: {
      async createInvited() {
        return {
          id: MEMBERSHIP_ID,
          tenantId: TENANT_ID,
          userId: USER_ID,
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
      async create() {
        return {
          id: INVITATION_ID,
          tenantId: TENANT_ID,
          normalizedEmail: "owner@example.test",
          invitedUserId: USER_ID,
          intendedRoleKey: "tenant_owner" as const,
          status: "pending" as const,
          hostname: "acme.booking.localhost",
          selector: "invite-selector",
          tokenHash: "b".repeat(64),
          expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
          acceptedAt: null,
          revokedAt: null,
          invitedByUserId: ACTOR_ID,
          createdAt: NOW,
          updatedAt: NOW,
        };
      },
    },
    roles: {
      async assign() {},
    },
    audit: {
      async append() {},
    },
    outbox: {
      async append(input: { readonly type: string }) {
        outboxTypes.push(input.type);
      },
    },
  } as unknown as PlatformTenantProvisioningDataSession;

  const idempotency: TenantProvisioningIdempotencyPort = {
    async claim() {
      return { status: "claimed" };
    },
    async complete() {},
  };

  const transaction: PlatformTenantProvisioningTransactionPort = {
    async run(work) {
      return work({
        idempotency,
        identity: {
          async findOrCreatePendingIdentity() {
            return { userId: USER_ID, status: "pending_activation", created: true };
          },
          async issueTenantActivation() {},
        },
        async runTenant<T>(
          _tenantId: string,
          tenantWork: (tenantSession: PlatformTenantProvisioningDataSession) => Promise<T>,
        ): Promise<T> {
          return tenantWork(session);
        },
      });
    },
  };

  const workflow = new PlatformTenantProvisioningWorkflow(transaction, {
    createTenantId: () => TENANT_ID,
    createOutboxEventId: () =>
      `70000000-0000-4000-8000-${String(++outboxSequence).padStart(12, "0")}`,
    invitationTokens: {
      issue() {
        return {
          selector: "invite-selector",
          serialized: "invite-token",
          tokenHash: "b".repeat(64),
        };
      },
    },
    invitationEnvelope: {
      seal() {
        return SEALED;
      },
    },
    activationTokens: {
      issue() {
        return {
          selector: "activation-selector",
          serialized: "activation-token",
          tokenHash: "d".repeat(64),
        };
      },
    },
    activationEnvelope: {
      seal() {
        return SEALED;
      },
    },
  });

  await workflow.provision({
    actorUserId: ACTOR_ID,
    idempotencyKey: "single-owner-onboarding",
    requestHash: "a".repeat(64),
    slug: "acme",
    tenantName: "Acme Studio",
    ownerEmail: "owner@example.test",
    normalizedOwnerEmail: "owner@example.test",
    tenantHostname: "acme.booking.localhost",
    requestId: "request-owner-onboarding",
    now: NOW,
  });

  assert.deepEqual(outboxTypes, ["membership.owner_onboarding.requested.v1"]);
});
