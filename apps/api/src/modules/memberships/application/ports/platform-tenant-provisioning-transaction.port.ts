import type { MembershipDataSession } from "./membership-data-session.js";
import type { TenantProvisioningIdempotencyPort } from "./tenant-provisioning-idempotency.port.js";

export interface PlatformTenantProvisioningTransactionContext {
  readonly idempotency: TenantProvisioningIdempotencyPort;
  runTenant<T>(
    tenantId: string,
    work: (session: MembershipDataSession) => Promise<T>,
  ): Promise<T>;
}

export interface PlatformTenantProvisioningTransactionPort {
  run<T>(work: (context: PlatformTenantProvisioningTransactionContext) => Promise<T>): Promise<T>;
}
