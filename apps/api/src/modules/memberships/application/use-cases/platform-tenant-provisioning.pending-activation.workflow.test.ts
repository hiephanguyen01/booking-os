import assert from "node:assert/strict";
import test from "node:test";

import type {
  PlatformTenantProvisioningDataSession,
  PlatformTenantProvisioningTransactionPort,
} from "../ports/platform-tenant-provisioning-transaction.port.js";
import type { ProvisionPlatformTenantInput } from "../ports/platform-tenant-provisioning-workflow.port.js";
import type { TenantProvisioningIdempotencyPort } from "../ports/tenant-provisioning-idempotency.port.js";
import { PlatformTenantProvisioningWorkflow } from "./platform-tenant-provisioning.workflow.js";

const NOW = new Date("2026-08-07T15:45:00.000Z");
const TENANT_ID = "30000000-0000-4000-8000-000000000101";
const OWNER_USER_ID = "60000000-0000-4000-8000-000000000101";
const OWNER_MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000101";
const OWNER_INVITATION_ID = "50000000-0000-4000-8000-000000000101";
const OUTBOX_EVENT_ID = "70000000-0000-4000-8000-000000000101";
const RAW_INVITATION_TOKEN = "raw-owner-invitation-token";
const RAW_ACTIVATION_TOKEN = "raw-owner-activation-token";
const INVITATION_SELECTOR = "owner-invitation-selector";
const ACTIVATION_SELECTOR = "owner-activation-selector";
const INVITATION_TOKEN_HASH = "b".repeat(64);
const ACTIVATION_TOKEN_HASH = "c".repeat(64);
const SEALED_ONBOARDING = Object.freeze({
  version: 1 as const,
  keyId: "owner-onboarding-key",
  iv: "onboarding-iv",
  ciphertext: "onboarding-ciphertext",
  tag: "onboarding-tag",
});

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

test("delivers pending owner activation and invitation in one encrypted onboarding event", async () => {
  const outboxEvents: Record<string, unknown>[] = [];
  let storedActivation: Record<string, unknown> | null = null;

  const session = {
    tenants: {
      async createProvisioning() {
        return {
          id: TENANT_ID,
          slug: INPUT.slug,
          name: INPUT.tenantName,
          status: "provisioning" as const,
        };
      },
      async addPrimaryDomain() {},
    },
    memberships: {
      async createInvited() {
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
      async create() {
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
          expiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000),
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
        outboxEvents.push(input);
      },
    },
    audit: { async append() {} },
  } as unknown as PlatformTenantProvisioningDataSession;

  const transaction: PlatformTenantProvisioningTransactionPort = {
    async run(work) {
      return work({
        idempotency: {
          async claim() {
            return { status: "claimed" };
          },
          async complete() {},
        } as TenantProvisioningIdempotencyPort,
        identity: {
          async findOrCreatePendingIdentity() {
            return { userId: OWNER_USER_ID, status: "pending_activation", created: true };
          },
          async issueTenantActivation(input) {
            storedActivation = input as unknown as Record<string, unknown>;
          },
        },
        async runTenant<T>(
          _tenantId: string,
          tenantWork: (tenantSession: PlatformTenantProvisioningDataSession) => Promise<T>,
        ) {
          return tenantWork(session);
        },
      });
    },
  };

  const workflow = new PlatformTenantProvisioningWorkflow(transaction, {
    createTenantId: () => TENANT_ID,
    createOutboxEventId: () => OUTBOX_EVENT_ID,
    invitationTokens: {
      issue() {
        return {
          selector: INVITATION_SELECTOR,
          serialized: RAW_INVITATION_TOKEN,
          tokenHash: INVITATION_TOKEN_HASH,
        };
      },
    },
    activationTokens: {
      issue() {
        return {
          selector: ACTIVATION_SELECTOR,
          serialized: RAW_ACTIVATION_TOKEN,
          tokenHash: ACTIVATION_TOKEN_HASH,
        };
      },
    },
    ownerOnboardingEnvelope: {
      seal(input) {
        assert.deepEqual(input, {
          eventId: OUTBOX_EVENT_ID,
          tenantId: TENANT_ID,
          invitationId: OWNER_INVITATION_ID,
          userId: OWNER_USER_ID,
          hostname: INPUT.tenantHostname,
          recipient: INPUT.normalizedOwnerEmail,
          activationToken: RAW_ACTIVATION_TOKEN,
          invitationToken: RAW_INVITATION_TOKEN,
        });
        return SEALED_ONBOARDING;
      },
    },
  });

  await workflow.provision(INPUT);

  assert.equal(outboxEvents.length, 1);
  assert.deepEqual(outboxEvents[0], {
    id: OUTBOX_EVENT_ID,
    type: "membership.owner_onboarding.requested.v1",
    aggregateType: "membership_invitation",
    aggregateId: OWNER_INVITATION_ID,
    payload: {
      version: 1,
      recipient: INPUT.normalizedOwnerEmail,
      hostname: INPUT.tenantHostname,
      purpose: "initial_owner_onboarding",
      tenantId: TENANT_ID,
      invitationId: OWNER_INVITATION_ID,
      userId: OWNER_USER_ID,
      envelope: SEALED_ONBOARDING,
    },
    occurredAt: NOW,
  });
  const serializedEvent = JSON.stringify(outboxEvents[0]);
  assert.equal(serializedEvent.includes(RAW_INVITATION_TOKEN), false);
  assert.equal(serializedEvent.includes(RAW_ACTIVATION_TOKEN), false);
  assert.ok(storedActivation);
  assert.equal(storedActivation.selector, ACTIVATION_SELECTOR);
  assert.equal(storedActivation.tokenHash, ACTIVATION_TOKEN_HASH);
  assert.equal(storedActivation.invitationId, OWNER_INVITATION_ID);
});
