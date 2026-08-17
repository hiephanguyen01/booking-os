import { randomUUID } from "node:crypto";
import { TenantNotAvailableError } from "../../domain/membership-errors.js";
import type { InitialOwnerOnboardingEnvelopePort } from "../ports/initial-owner-onboarding-envelope.port.js";
import type { MembershipInvitationEnvelopePort } from "../ports/membership-invitation-envelope.port.js";
import type { MembershipInvitationTokenPort } from "../ports/membership-invitation-token.port.js";
import type { PlatformTenantProvisioningTransactionPort } from "../ports/platform-tenant-provisioning-transaction.port.js";
import type {
  ProvisionPlatformTenantInput,
  ProvisionPlatformTenantResult,
  ResendOwnerInvitationInput,
  ResendOwnerInvitationResult,
} from "../ports/platform-tenant-provisioning-workflow.port.js";
import type { TenantActivationEnvelopePort } from "../ports/tenant-activation-envelope.port.js";
import type { TenantActivationTokenPort } from "../ports/tenant-activation-token.port.js";

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface PlatformTenantProvisioningWorkflowDependencies {
  readonly createTenantId?: () => string;
  readonly createOutboxEventId?: () => string;
  readonly invitationTokens?: MembershipInvitationTokenPort;
  readonly invitationEnvelope?: MembershipInvitationEnvelopePort;
  readonly activationTokens?: TenantActivationTokenPort;
  readonly activationEnvelope?: TenantActivationEnvelopePort;
  readonly ownerOnboardingEnvelope?: InitialOwnerOnboardingEnvelopePort;
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

const unavailableOwnerOnboardingEnvelope: InitialOwnerOnboardingEnvelopePort = Object.freeze({
  seal() {
    throw new Error("Initial owner onboarding envelope sealer is not configured.");
  },
});

export class PlatformTenantProvisioningWorkflow {
  private readonly createTenantId: () => string;
  private readonly createOutboxEventId: () => string;
  private readonly invitationTokens: MembershipInvitationTokenPort;
  private readonly invitationEnvelope: MembershipInvitationEnvelopePort;
  private readonly activationTokens: TenantActivationTokenPort;
  private readonly ownerOnboardingEnvelope: InitialOwnerOnboardingEnvelopePort;

  constructor(
    private readonly transaction: PlatformTenantProvisioningTransactionPort,
    dependencies: PlatformTenantProvisioningWorkflowDependencies = {},
  ) {
    this.createTenantId = dependencies.createTenantId ?? randomUUID;
    this.createOutboxEventId = dependencies.createOutboxEventId ?? randomUUID;
    this.invitationTokens = dependencies.invitationTokens ?? unavailableInvitationTokens;
    this.invitationEnvelope = dependencies.invitationEnvelope ?? unavailableInvitationEnvelope;
    this.activationTokens = dependencies.activationTokens ?? unavailableActivationTokens;
    this.ownerOnboardingEnvelope =
      dependencies.ownerOnboardingEnvelope ?? unavailableOwnerOnboardingEnvelope;
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
        const deliveryEventId = this.createOutboxEventId();

        if (activationToken) {
          const onboardingEnvelope = this.ownerOnboardingEnvelope.seal({
            eventId: deliveryEventId,
            tenantId,
            invitationId: invitation.id,
            userId: ownerIdentity.userId,
            hostname: input.tenantHostname,
            recipient: input.normalizedOwnerEmail,
            activationToken: activationToken.serialized,
            invitationToken: invitationToken.serialized,
          });
          await session.outbox.append({
            id: deliveryEventId,
            type: "membership.owner_onboarding.requested.v1",
            aggregateType: "membership_invitation",
            aggregateId: invitation.id,
            payload: {
              version: 1,
              recipient: input.normalizedOwnerEmail,
              hostname: input.tenantHostname,
              purpose: "initial_owner_onboarding",
              tenantId,
              invitationId: invitation.id,
              userId: ownerIdentity.userId,
              envelope: onboardingEnvelope,
            },
            occurredAt: input.now,
          });
        } else {
          const invitationEnvelope = this.invitationEnvelope.seal({
            eventId: deliveryEventId,
            tenantId,
            invitationId: invitation.id,
            userId: ownerIdentity.userId,
            hostname: input.tenantHostname,
            normalizedEmail: input.normalizedOwnerEmail,
            intendedRoleKey: "tenant_owner",
            serializedToken: invitationToken.serialized,
          });
          await session.outbox.append({
            id: deliveryEventId,
            type: "membership.owner_invitation.requested.v1",
            aggregateType: "membership_invitation",
            aggregateId: invitation.id,
            payload: {
              version: 1,
              recipient: input.normalizedOwnerEmail,
              hostname: input.tenantHostname,
              purpose: "membership_invitation",
              userId: ownerIdentity.userId,
              intendedRoleKey: "tenant_owner",
              envelope: invitationEnvelope,
            },
            occurredAt: input.now,
          });
        }

        await session.audit.append({
          eventType: "tenant.provisioned",
          actorUserId: input.actorUserId,
          subjectUserId: ownerIdentity.userId,
          requestId: input.requestId,
          metadata: {
            tenantId,
            status: tenant.status,
            reason: "platform_provisioning",
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

  async resendOwnerInvitation(
    input: ResendOwnerInvitationInput,
  ): Promise<ResendOwnerInvitationResult> {
    return this.transaction.run(async (context) => {
      const lockedInvitation = await context.runTenant(input.tenantId, async (session) => {
        const tenant = await session.tenants.lockCurrent();
        const invitation = await session.invitations.lockPendingOwnerInvitation();
        if (tenant?.status !== "provisioning" || !invitation || !invitation.invitedUserId) {
          throw new TenantNotAvailableError();
        }
        return invitation;
      });

      const ownerIdentity = await context.identity.findOrCreatePendingIdentity({
        normalizedEmail: lockedInvitation.normalizedEmail,
        displayEmail: lockedInvitation.normalizedEmail,
        now: input.now,
      });
      if (ownerIdentity.userId !== lockedInvitation.invitedUserId) {
        throw new TenantNotAvailableError();
      }

      const invitationToken = this.invitationTokens.issue({
        tenantId: input.tenantId,
        userId: ownerIdentity.userId,
        hostname: lockedInvitation.hostname,
        normalizedEmail: lockedInvitation.normalizedEmail,
        intendedRoleKey: "tenant_owner",
      });
      const activationToken =
        ownerIdentity.status === "pending_activation"
          ? this.activationTokens.issue({
              tenantId: input.tenantId,
              hostname: lockedInvitation.hostname,
            })
          : null;
      const expiresAt = new Date(input.now.getTime() + INVITATION_TTL_MS);

      const result = await context.runTenant(input.tenantId, async (session) => {
        const tenant = await session.tenants.lockCurrent();
        const invitation = await session.invitations.lockPendingOwnerInvitation();
        if (
          tenant?.status !== "provisioning" ||
          !invitation ||
          invitation.id !== lockedInvitation.id ||
          invitation.invitedUserId !== ownerIdentity.userId ||
          invitation.normalizedEmail !== lockedInvitation.normalizedEmail ||
          invitation.hostname !== lockedInvitation.hostname
        ) {
          throw new TenantNotAvailableError();
        }

        await session.invitations.revoke(invitation.id, input.now);
        const replacement = await session.invitations.create({
          normalizedEmail: invitation.normalizedEmail,
          invitedUserId: ownerIdentity.userId,
          intendedRoleKey: "tenant_owner",
          hostname: invitation.hostname,
          selector: invitationToken.selector,
          tokenHash: invitationToken.tokenHash,
          expiresAt,
          invitedByUserId: input.actorUserId,
          now: input.now,
        });
        const deliveryEventId = this.createOutboxEventId();

        if (activationToken) {
          await session.outbox.append({
            id: deliveryEventId,
            type: "membership.owner_onboarding.requested.v1",
            aggregateType: "membership_invitation",
            aggregateId: replacement.id,
            payload: {
              version: 1,
              recipient: invitation.normalizedEmail,
              hostname: invitation.hostname,
              purpose: "initial_owner_onboarding",
              tenantId: input.tenantId,
              invitationId: replacement.id,
              userId: ownerIdentity.userId,
              envelope: this.ownerOnboardingEnvelope.seal({
                eventId: deliveryEventId,
                tenantId: input.tenantId,
                invitationId: replacement.id,
                userId: ownerIdentity.userId,
                hostname: invitation.hostname,
                recipient: invitation.normalizedEmail,
                activationToken: activationToken.serialized,
                invitationToken: invitationToken.serialized,
              }),
            },
            occurredAt: input.now,
          });
        } else {
          await session.outbox.append({
            id: deliveryEventId,
            type: "membership.owner_invitation.requested.v1",
            aggregateType: "membership_invitation",
            aggregateId: replacement.id,
            payload: {
              version: 1,
              recipient: invitation.normalizedEmail,
              hostname: invitation.hostname,
              purpose: "membership_invitation",
              userId: ownerIdentity.userId,
              intendedRoleKey: "tenant_owner",
              envelope: this.invitationEnvelope.seal({
                eventId: deliveryEventId,
                tenantId: input.tenantId,
                invitationId: replacement.id,
                userId: ownerIdentity.userId,
                hostname: invitation.hostname,
                normalizedEmail: invitation.normalizedEmail,
                intendedRoleKey: "tenant_owner",
                serializedToken: invitationToken.serialized,
              }),
            },
            occurredAt: input.now,
          });
        }

        await session.audit.append({
          eventType: "membership.invitation_resent",
          actorUserId: input.actorUserId,
          subjectUserId: ownerIdentity.userId,
          requestId: input.requestId,
          metadata: { previousInvitationId: invitation.id, invitationId: replacement.id },
          occurredAt: input.now,
        });

        return { ownerIdentity, invitation: replacement, expiresAt, activationToken };
      });

      if (result.activationToken) {
        await context.identity.issueTenantActivation({
          userId: result.ownerIdentity.userId,
          tenantId: input.tenantId,
          invitationId: result.invitation.id,
          hostname: result.invitation.hostname,
          selector: result.activationToken.selector,
          tokenHash: result.activationToken.tokenHash,
          expiresAt: result.expiresAt,
          now: input.now,
        });
      }

      return Object.freeze({ accepted: true });
    });
  }
}
