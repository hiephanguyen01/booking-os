import type { ProvisionPlatformTenantResult } from "./platform-tenant-provisioning-workflow.port.js";

export type ClaimTenantProvisioningInput = Readonly<{
  key: string;
  requestHash: string;
  actorUserId: string;
  now: Date;
}>;

export type ClaimTenantProvisioningResult =
  | Readonly<{ status: "claimed" }>
  | Readonly<{
      status: "completed";
      result: ProvisionPlatformTenantResult;
    }>;

export type CompleteTenantProvisioningInput = Readonly<{
  key: string;
  requestHash: string;
  result: ProvisionPlatformTenantResult;
  completedAt: Date;
}>;

export interface TenantProvisioningIdempotencyPort {
  claim(input: ClaimTenantProvisioningInput): Promise<ClaimTenantProvisioningResult>;
  complete(input: CompleteTenantProvisioningInput): Promise<void>;
}
