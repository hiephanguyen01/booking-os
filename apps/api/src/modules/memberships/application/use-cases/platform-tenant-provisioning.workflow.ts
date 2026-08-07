import type { PlatformTenantProvisioningTransactionPort } from "../ports/platform-tenant-provisioning-transaction.port.js";
import type {
  ProvisionPlatformTenantInput,
  ProvisionPlatformTenantResult,
} from "../ports/platform-tenant-provisioning-workflow.port.js";

export class PlatformTenantProvisioningWorkflow {
  constructor(private readonly transaction: PlatformTenantProvisioningTransactionPort) {}

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

      throw new Error("Fresh tenant provisioning is not implemented yet.");
    });
  }
}
