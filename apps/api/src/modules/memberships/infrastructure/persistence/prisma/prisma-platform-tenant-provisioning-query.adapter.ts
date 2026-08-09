import { Inject, Injectable } from "@nestjs/common";
import type { PlatformTenantProvisioningTransactionPort } from "../../../application/ports/platform-tenant-provisioning-transaction.port.js";
import type {
  GetPlatformTenantProvisioningInput,
  GetPlatformTenantProvisioningResult,
  PlatformTenantProvisioningQueryPort,
} from "../../../application/ports/platform-tenant-provisioning-workflow.port.js";
import { TenantNotAvailableError } from "../../../domain/membership-errors.js";
import { PLATFORM_TENANT_PROVISIONING_TRANSACTION_PORT } from "../../../memberships.tokens.js";

@Injectable()
export class PrismaPlatformTenantProvisioningQueryAdapter
  implements PlatformTenantProvisioningQueryPort
{
  constructor(
    @Inject(PLATFORM_TENANT_PROVISIONING_TRANSACTION_PORT)
    private readonly transaction: PlatformTenantProvisioningTransactionPort,
  ) {}

  async getProvisioning(
    input: GetPlatformTenantProvisioningInput,
  ): Promise<GetPlatformTenantProvisioningResult> {
    return this.transaction.run((context) =>
      context.runTenant(input.tenantId, async (session) => {
        const tenant = await session.tenants.findCurrent();
        const invitation = await session.invitations.findPendingOwnerInvitation();
        if (tenant?.status !== "provisioning" || !invitation?.invitedUserId) {
          throw new TenantNotAvailableError();
        }
        const membership = await session.memberships.findByUserId(invitation.invitedUserId);
        if (!membership) {
          throw new TenantNotAvailableError();
        }
        return Object.freeze({
          tenantId: tenant.id,
          tenantName: tenant.name,
          slug: tenant.slug,
          status: "provisioning",
          ownerMembershipId: membership.id,
          ownerInvitationId: invitation.id,
        });
      }),
    );
  }
}
