import type { TenantExecutionContext } from "@booking-os/contracts";
import type { TenantProbeRepositoryPort } from "./tenant-probe-repository.port.js";

export interface TenantDataSession {
  readonly tenantProbes: TenantProbeRepositoryPort;
}

export interface TenantTransactionPort {
  run<T>(context: TenantExecutionContext, work: (session: TenantDataSession) => Promise<T>): Promise<T>;
}
