import { randomUUID } from "node:crypto";

import type { MembershipInvitationEnvelopePort } from "../ports/membership-invitation-envelope.port.js";
import type { MembershipInvitationTokenPort } from "../ports/membership-invitation-token.port.js";
import type { PlatformTenantProvisioningTransactionPort } from "../ports/platform-tenant-provisioning-transaction.port.js";
import type {
  ProvisionPlatformTenantInput,
  ProvisionPlatformTenantResult,
} from "../ports/platform-tenant-provisioning-workflow.port.js";

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface PlatformTenantProvisioningWorkflowDependencies {
  readonly createTenantId?: () => string;
  readonly createOutboxEventId?: () => string;
  readonly invitationTokens?: MembershipInvitationTokenPort;
  readonly invitationEnvelope?: MembershipInvitationEnvelopePort;
}

const unavailableInvitationTokens: MembershipInvitationTokenPort = Object.freeze({
  issue() {
    throw new Error("Membership invitation token issuer is not configured.");
  },
});

const unavailableInvitationEnvelope: MembershipInvitationEnvelopePort = Object.freeze({
  seal() {
    throw new Error("Membership invitation envelope sealer is not configured.");
  },
});

export class PlatformTenantProvisioningWorkflow {
  private readonly createTenantId: () => string;
  private readonly createOutboxEventId: () => string;
  private readonly invitationTokens: MembershipInvitationTokenPort;
  private readonly invitationEnvelope: MembershipInvitationEnvelopePort;

  constructor(
    private readonly transaction: PlatformTenantProvisioningTransactionPort,
    dependencies: PlatformTenantProvisioningWorkflowDependencies = {},
  ) {
    this.createTenantId = dependencies.createTenantId ?? randomUUID;
    this.createOutboxEventId = dependencies.createOutboxEventId ?? randomUUID;
    this.invitationTokens = dependencies.invitationTokens ?? unavailableInvitationTokens;
    this.invitationEnvelope = dependencies.invitationEnvelope ?? unavailableInvitationEnvelope;
  }

  async provision(input: ProvisionPlatformTenantInput): Promise<ProvisionPlatformTenantResult> {
    return this.transaction.run(async (context) => {
      const claim = await context.idempotency.claim({
        key: input.idempotencyKey,
        requestHash: input.requestHash,
        actorUserId: input.actorUserId,
        now: input.now,
      });

      if (claim.status === "completed") {
        return claim.result;
      }

      const tenantId = this.createTenantId();
      const ownerIdentity = await context.identity.findOrCreatePendingIdentity({
        normalizedEmail: input.normalizedOwnerEmail,
        displayEmail: input.ownerEmail,
        now: input.now,
      });
      const invitationToken = this.invitationTokens.issue({
        tenantId,
        userId: ownerIdentity.userId,
        hostname: input.tenantHostname,
        normalizedEmail: input.normalizedOwnerEmail,
        intendedRoleKey: "tenant_owner",
      });
      const invitationExpiresAt = new Date(input.now.getTime() + INVITATION_TTL_MS);

      const provisioned = await context.runTenant(tenantId, async (session) => {
        const tenant = await session.tenants.createProvisioning({
          slug: input.slug,
          name: input.tenantName,
          now: input.now,
        });
        await session.tenants.addPrimaryDomain(input.tenantHostname, input.now);
        const membership = await session.memberships.createInvited({
          userId: ownerIdentity.userId,
          now: input.now,
        });
        const invitation = await session.invitations.create({
          normalizedEmail: input.normalizedOwnerEmail,
          invitedUserId: ownerIdentity.userId,
          intendedRoleKey: "tenant_owner",
          hostname: input.tenantHostname,
          selector: invitationToken.selector,
          tokenHash: invitationToken.tokenHash,
          expiresAt: invitationExpiresAt,
          invitedByUserId: input.actorUserId,
          now: input.now,
        });
        const outboxEventId = this.createOutboxEventId();
        const envelope = this.invitationEnvelope.seal({
          eventId: outboxEventId,
          tenantId,
          invitationId: invitation.id,
          userId: ownerIdentity.userId,
          hostname: input.tenantHostname,
          normalizedEmail: input.normalizedOwnerEmail,
          intendedRoleKey: "tenant_owner",
          serializedToken: invitationToken.serialized,
        });
        await session.outbox.append({
          id: outboxEventId,
          type: "membership.owner_invitation.requested.v1",
          aggregateType: "membership_invitation",
          aggregateId: invitation.id,
          payload: {
            version: 1,
            recipient: input.normalizedOwnerEmail,
            hostname: input.tenantHostname,
            purpose: "membership_invitation",
            envelope,
          },
          occurredAt: input.now,
        });
        await session.audit.append({
          eventType: "membership.invited",
          actorUserId: input.actorUserId,
          subjectUserId: ownerIdentity.userId,
          requestId: input.requestId,
          metadata: {
            membershipId: membership.id,
            invitationId: invitation.id,
            intendedRoleKey: "tenant_owner",
          },
          occurredAt: input.now,
        });

        return { tenant, membership, invitation };
      });

      const result: ProvisionPlatformTenantResult = Object.freeze({
        tenantId: provisioned.tenant.id,
        slug: provisioned.tenant.slug,
        status: provisioned.tenant.status,
        ownerMembershipId: provisioned.membership.id,
        ownerInvitationId: provisioned.invitation.id,
        replayed: false,
      });

      await context.idempotency.complete({
        key: input.idempotencyKey,
        requestHash: input.requestHash,
        result,
        completedAt: input.now,
      });

      return result;
    });
  }
}
