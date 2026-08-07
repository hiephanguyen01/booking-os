import { randomUUID } from "node:crypto";

import type { MembershipInvitationEnvelopePort } from "../ports/membership-invitation-envelope.port.js";
import type { MembershipInvitationTokenPort } from "../ports/membership-invitation-token.port.js";
import type { PlatformTenantProvisioningTransactionPort } from "../ports/platform-tenant-provisioning-transaction.port.js";
import type { TenantActivationEnvelopePort } from "../ports/tenant-activation-envelope.port.js";
import type { TenantActivationTokenPort } from "../ports/tenant-activation-token.port.js";
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
  readonly activationTokens?: TenantActivationTokenPort;
  readonly activationEnvelope?: TenantActivationEnvelopePort;
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

const unavailableActivationTokens: TenantActivationTokenPort = Object.freeze({
  issue() {
    throw new Error("Tenant activation token issuer is not configured.");
  },
});

const unavailableActivationEnvelope: TenantActivationEnvelopePort = Object.freeze({
  seal() {
    throw new Error("Tenant activation envelope sealer is not configured.");
  },
});

export class PlatformTenantProvisioningWorkflow {
  private readonly createTenantId: () => string;
  private readonly createOutboxEventId: () => string;
  private readonly invitationTokens: MembershipInvitationTokenPort;
  private readonly invitationEnvelope: MembershipInvitationEnvelopePort;
  private readonly activationTokens: TenantActivationTokenPort;
  private readonly activationEnvelope: TenantActivationEnvelopePort;

  constructor(
    private readonly transaction: PlatformTenantProvisioningTransactionPort,
    dependencies: PlatformTenantProvisioningWorkflowDependencies = {},
  ) {
    this.createTenantId = dependencies.createTenantId ?? randomUUID;
    this.createOutboxEventId = dependencies.createOutboxEventId ?? randomUUID;
    this.invitationTokens = dependencies.invitationTokens ?? unavailableInvitationTokens;
    this.invitationEnvelope = dependencies.invitationEnvelope ?? unavailableInvitationEnvelope;
    this.activationTokens = dependencies.activationTokens ?? unavailableActivationTokens;
    this.activationEnvelope = dependencies.activationEnvelope ?? unavailableActivationEnvelope;
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
      const activationToken =
        ownerIdentity.status === "pending_activation"
          ? this.activationTokens.issue({
              tenantId,
              hostname: input.tenantHostname,
            })
          : null;
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
        const invitationEventId = this.createOutboxEventId();
        const invitationEnvelope = this.invitationEnvelope.seal({
          eventId: invitationEventId,
          tenantId,
          invitationId: invitation.id,
          userId: ownerIdentity.userId,
          hostname: input.tenantHostname,
          normalizedEmail: input.normalizedOwnerEmail,
          intendedRoleKey: "tenant_owner",
          serializedToken: invitationToken.serialized,
        });
        await session.outbox.append({
          id: invitationEventId,
          type: "membership.owner_invitation.requested.v1",
          aggregateType: "membership_invitation",
          aggregateId: invitation.id,
          payload: {
            version: 1,
            recipient: input.normalizedOwnerEmail,
            hostname: input.tenantHostname,
            purpose: "membership_invitation",
            envelope: invitationEnvelope,
          },
          occurredAt: input.now,
        });

        if (activationToken) {
          const activationEventId = this.createOutboxEventId();
          const activationEnvelope = this.activationEnvelope.seal({
            eventId: activationEventId,
            tenantId,
            invitationId: invitation.id,
            userId: ownerIdentity.userId,
            hostname: input.tenantHostname,
            recipient: input.normalizedOwnerEmail,
            serializedToken: activationToken.serialized,
          });
          await session.outbox.append({
            id: activationEventId,
            type: "identity.activation.requested.v1",
            aggregateType: "user",
            aggregateId: ownerIdentity.userId,
            payload: {
              version: 1,
              recipient: input.normalizedOwnerEmail,
              template: "account_activation",
              hostname: input.tenantHostname,
              envelope: activationEnvelope,
            },
            occurredAt: input.now,
          });
        }

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

      if (activationToken) {
        await context.identity.issueTenantActivation({
          userId: ownerIdentity.userId,
          tenantId,
          invitationId: provisioned.invitation.id,
          hostname: input.tenantHostname,
          selector: activationToken.selector,
          tokenHash: activationToken.tokenHash,
          expiresAt: invitationExpiresAt,
          now: input.now,
        });
      }

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
