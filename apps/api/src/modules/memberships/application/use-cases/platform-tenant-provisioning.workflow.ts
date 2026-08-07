import { randomUUID } from "node:crypto";

import type { MembershipInvitationTokenPort } from "../ports/membership-invitation-token.port.js";
import type { PlatformTenantProvisioningTransactionPort } from "../ports/platform-tenant-provisioning-transaction.port.js";
import type {
  ProvisionPlatformTenantInput,
  ProvisionPlatformTenantResult,
} from "../ports/platform-tenant-provisioning-workflow.port.js";

const INVITATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface PlatformTenantProvisioningWorkflowDependencies {
  readonly createTenantId?: () => string;
  readonly invitationTokens?: MembershipInvitationTokenPort;
}

const unavailableInvitationTokens: MembershipInvitationTokenPort = Object.freeze({
  issue() {
    throw new Error("Membership invitation token issuer is not configured.");
  },
});

export class PlatformTenantProvisioningWorkflow {
  private readonly createTenantId: () => string;
  private readonly invitationTokens: MembershipInvitationTokenPort;

  constructor(
    private readonly transaction: PlatformTenantProvisioningTransactionPort,
    dependencies: PlatformTenantProvisioningWorkflowDependencies = {},
  ) {
    this.createTenantId = dependencies.createTenantId ?? randomUUID;
    this.invitationTokens = dependencies.invitationTokens ?? unavailableInvitationTokens;
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
