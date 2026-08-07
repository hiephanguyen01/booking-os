import type { IdentityProvisioningPort } from "./identity-provisioning.port.js";
import type { MembershipDataSession } from "./membership-data-session.js";
import type { TenantOutboxPort } from "./tenant-outbox.port.js";
import type { TenantProvisioningIdempotencyPort } from "./tenant-provisioning-idempotency.port.js";

export interface PlatformTenantProvisioningDataSession extends MembershipDataSession {
  readonly outbox: TenantOutboxPort;
}

export interface PlatformTenantProvisioningTransactionContext {
  readonly idempotency: TenantProvisioningIdempotencyPort;
  readonly identity: IdentityProvisioningPort;
  runTenant<T>(
    tenantId: string,
    work: (session: PlatformTenantProvisioningDataSession) => Promise<T>,
  ): Promise<T>;
}

export interface PlatformTenantProvisioningTransactionPort {
  run<T>(work: (context: PlatformTenantProvisioningTransactionContext) => Promise<T>): Promise<T>;
}
