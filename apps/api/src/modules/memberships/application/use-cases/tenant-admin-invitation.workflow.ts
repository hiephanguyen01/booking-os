import { randomUUID } from "node:crypto";

import { InvitationInvalidOrExpiredError } from "../../domain/membership-errors.js";
import type { MembershipInvitationTokenPort } from "../ports/membership-invitation-token.port.js";
import type {
  PlatformTenantProvisioningDataSession,
  PlatformTenantProvisioningTransactionPort,
} from "../ports/platform-tenant-provisioning-transaction.port.js";
import type {
  CurrentInvitationWorkflowResult,
  GetCurrentInvitationWorkflowInput,
  InviteTenantAdminWorkflowInput,
  ResendTenantAdminInvitationWorkflowInput,
  TenantAdminInvitationWorkflowPort,
} from "../ports/tenant-admin-invitation-workflow.port.js";
import type { TenantActivationEnvelopePort } from "../ports/tenant-activation-envelope.port.js";
import type { TenantActivationTokenPort } from "../ports/tenant-activation-token.port.js";
import type { TenantAdminInvitationEnvelopePort } from "../ports/tenant-admin-invitation-envelope.port.js";

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;
const ADMIN_INVITATION_EVENT = "membership.admin_invitation.requested.v1" as const;

export interface TenantAdminInvitationWorkflowDependencies {
  readonly createOutboxEventId?: () => string;
  readonly invitationTokens: MembershipInvitationTokenPort;
  readonly invitationEnvelope: TenantAdminInvitationEnvelopePort;
  readonly activationTokens: TenantActivationTokenPort;
  readonly activationEnvelope: TenantActivationEnvelopePort;
}

export class TenantAdminInvitationWorkflow implements TenantAdminInvitationWorkflowPort {
  private readonly createOutboxEventId: () => string;

  constructor(
    private readonly transaction: PlatformTenantProvisioningTransactionPort,
    private readonly dependencies: TenantAdminInvitationWorkflowDependencies,
  ) {
    this.createOutboxEventId = dependencies.createOutboxEventId ?? randomUUID;
  }

  async inviteTenantAdmin(input: InviteTenantAdminWorkflowInput): Promise<{ readonly accepted: true }> {
    return this.transaction.run(async (context) => {
      const identity = await context.identity.findOrCreatePendingIdentity({
        normalizedEmail: input.normalizedEmail,
        displayEmail: input.displayEmail,
        now: input.now,
      });

      const duplicate = await context.runTenant(input.tenantId, async (session) => {
        if (await session.memberships.findByUserId(identity.userId)) return true;
        return Boolean(
          await session.invitations.findPendingByEmailAndRole(
            input.normalizedEmail,
            "tenant_admin",
          ),
        );
      });
      if (duplicate) return Object.freeze({ accepted: true });

      const invitationToken = this.dependencies.invitationTokens.issue({
        tenantId: input.tenantId,
        userId: identity.userId,
        hostname: input.hostname,
        normalizedEmail: input.normalizedEmail,
        intendedRoleKey: "tenant_admin",
      });
      const activationToken =
        identity.status === "pending_activation"
          ? this.dependencies.activationTokens.issue({
              tenantId: input.tenantId,
              hostname: input.hostname,
            })
          : null;
      const expiresAt = new Date(input.now.getTime() + INVITATION_TTL_MS);

      const created = await context.runTenant(input.tenantId, async (session) => {
        const membership = await session.memberships.createInvited({
          userId: identity.userId,
          now: input.now,
        });
        const invitation = await session.invitations.create({
          normalizedEmail: input.normalizedEmail,
          invitedUserId: identity.userId,
          intendedRoleKey: "tenant_admin",
          hostname: input.hostname,
          selector: invitationToken.selector,
          tokenHash: invitationToken.tokenHash,
          expiresAt,
          invitedByUserId: input.actorUserId,
          now: input.now,
        });
        await this.appendInvitationEmail(session, {
          tenantId: input.tenantId,
          invitationId: invitation.id,
          userId: identity.userId,
          hostname: input.hostname,
          recipient: input.normalizedEmail,
          serializedToken: invitationToken.serialized,
          occurredAt: input.now,
        });
        if (activationToken) {
          await this.appendActivationEmail(session, {
            tenantId: input.tenantId,
            invitationId: invitation.id,
            userId: identity.userId,
            hostname: input.hostname,
            recipient: input.normalizedEmail,
            serializedToken: activationToken.serialized,
            occurredAt: input.now,
          });
        }
        await session.audit.append({
          eventType: "membership.invited",
          actorUserId: input.actorUserId,
          subjectUserId: identity.userId,
          requestId: input.requestId,
          metadata: {
            membershipId: membership.id,
            invitationId: invitation.id,
            intendedRoleKey: "tenant_admin",
          },
          occurredAt: input.now,
        });
        return invitation;
      });

      if (activationToken) {
        await context.identity.issueTenantActivation({
          userId: identity.userId,
          tenantId: input.tenantId,
          invitationId: created.id,
          hostname: input.hostname,
          selector: activationToken.selector,
          tokenHash: activationToken.tokenHash,
          expiresAt,
          now: input.now,
        });
      }

      return Object.freeze({ accepted: true });
    });
  }

  async resendInvitation(
    input: ResendTenantAdminInvitationWorkflowInput,
  ): Promise<{ readonly accepted: true }> {
    return this.transaction.run(async (context) => {
      const locked = await context.runTenant(input.tenantId, (session) =>
        session.invitations.lockPendingById(input.invitationId),
      );
      if (
        !locked ||
        !locked.invitedUserId ||
        locked.intendedRoleKey !== "tenant_admin" ||
        locked.hostname !== input.hostname
      ) {
        throw new InvitationInvalidOrExpiredError();
      }

      const identity = await context.identity.findOrCreatePendingIdentity({
        normalizedEmail: locked.normalizedEmail,
        displayEmail: locked.normalizedEmail,
        now: input.now,
      });
      if (identity.userId !== locked.invitedUserId) throw new InvitationInvalidOrExpiredError();

      const invitationToken = this.dependencies.invitationTokens.issue({
        tenantId: input.tenantId,
        userId: identity.userId,
        hostname: locked.hostname,
        normalizedEmail: locked.normalizedEmail,
        intendedRoleKey: "tenant_admin",
      });
      const activationToken =
        identity.status === "pending_activation"
          ? this.dependencies.activationTokens.issue({
              tenantId: input.tenantId,
              hostname: locked.hostname,
            })
          : null;
      const expiresAt = new Date(input.now.getTime() + INVITATION_TTL_MS);

      const replacement = await context.runTenant(input.tenantId, async (session) => {
        const current = await session.invitations.lockPendingById(input.invitationId);
        if (!current || current.id !== locked.id || current.hostname !== locked.hostname) {
          throw new InvitationInvalidOrExpiredError();
        }
        await session.invitations.revoke(current.id, input.now);
        const invitation = await session.invitations.create({
          normalizedEmail: current.normalizedEmail,
          invitedUserId: identity.userId,
          intendedRoleKey: "tenant_admin",
          hostname: current.hostname,
          selector: invitationToken.selector,
          tokenHash: invitationToken.tokenHash,
          expiresAt,
          invitedByUserId: input.actorUserId,
          now: input.now,
        });
        await this.appendInvitationEmail(session, {
          tenantId: input.tenantId,
          invitationId: invitation.id,
          userId: identity.userId,
          hostname: current.hostname,
          recipient: current.normalizedEmail,
          serializedToken: invitationToken.serialized,
          occurredAt: input.now,
        });
        if (activationToken) {
          await this.appendActivationEmail(session, {
            tenantId: input.tenantId,
            invitationId: invitation.id,
            userId: identity.userId,
            hostname: current.hostname,
            recipient: current.normalizedEmail,
            serializedToken: activationToken.serialized,
            occurredAt: input.now,
          });
        }
        await session.audit.append({
          eventType: "membership.invitation.resent",
          actorUserId: input.actorUserId,
          subjectUserId: identity.userId,
          requestId: input.requestId,
          metadata: { previousInvitationId: current.id, invitationId: invitation.id },
          occurredAt: input.now,
        });
        return invitation;
      });

      if (activationToken) {
        await context.identity.issueTenantActivation({
          userId: identity.userId,
          tenantId: input.tenantId,
          invitationId: replacement.id,
          hostname: replacement.hostname,
          selector: activationToken.selector,
          tokenHash: activationToken.tokenHash,
          expiresAt,
          now: input.now,
        });
      }

      return Object.freeze({ accepted: true });
    });
  }

  async getCurrentInvitation(
    input: GetCurrentInvitationWorkflowInput,
  ): Promise<CurrentInvitationWorkflowResult | null> {
    return this.transaction.run((context) =>
      context.runTenant(input.tenantId, async (session) => {
        const invitation = await session.invitations.findCurrentForUser(input.userId);
        if (!invitation || !invitation.invitedUserId) return null;
        return Object.freeze({
          id: invitation.id,
          tenantId: invitation.tenantId,
          invitedUserId: invitation.invitedUserId,
          intendedRoleKey: invitation.intendedRoleKey,
          hostname: invitation.hostname,
          expiresAt: invitation.expiresAt,
        });
      }),
    );
  }

  private async appendInvitationEmail(
    session: PlatformTenantProvisioningDataSession,
    input: {
      readonly tenantId: string;
      readonly invitationId: string;
      readonly userId: string;
      readonly hostname: string;
      readonly recipient: string;
      readonly serializedToken: string;
      readonly occurredAt: Date;
    },
  ): Promise<void> {
    const eventId = this.createOutboxEventId();
    await session.outbox.append({
      id: eventId,
      type: ADMIN_INVITATION_EVENT,
      aggregateType: "membership_invitation",
      aggregateId: input.invitationId,
      payload: {
        version: 1,
        recipient: input.recipient,
        hostname: input.hostname,
        purpose: "membership_invitation",
        userId: input.userId,
        intendedRoleKey: "tenant_admin",
        envelope: this.dependencies.invitationEnvelope.seal({
          eventId,
          tenantId: input.tenantId,
          invitationId: input.invitationId,
          userId: input.userId,
          hostname: input.hostname,
          normalizedEmail: input.recipient,
          serializedToken: input.serializedToken,
        }),
      },
      occurredAt: input.occurredAt,
    });
  }

  private async appendActivationEmail(
    session: PlatformTenantProvisioningDataSession,
    input: {
      readonly tenantId: string;
      readonly invitationId: string;
      readonly userId: string;
      readonly hostname: string;
      readonly recipient: string;
      readonly serializedToken: string;
      readonly occurredAt: Date;
    },
  ): Promise<void> {
    const eventId = this.createOutboxEventId();
    await session.outbox.append({
      id: eventId,
      type: "identity.activation.requested.v1",
      aggregateType: "user",
      aggregateId: input.userId,
      payload: {
        version: 1,
        recipient: input.recipient,
        template: "account_activation",
        hostname: input.hostname,
        envelope: this.dependencies.activationEnvelope.seal({
          eventId,
          tenantId: input.tenantId,
          invitationId: input.invitationId,
          userId: input.userId,
          hostname: input.hostname,
          recipient: input.recipient,
          serializedToken: input.serializedToken,
        }),
      },
      occurredAt: input.occurredAt,
    });
  }
}
