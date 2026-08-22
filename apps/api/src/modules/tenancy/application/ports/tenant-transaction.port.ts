import type {
  AuthorizedTenantExecutionContext,
  TenantExecutionContext,
} from "@booking-os/contracts";

import type { TenantRbacDataSession } from "../../../authorization/application/ports/tenant-rbac-data-session.js";
import type { MembershipDataSession } from "../../../memberships/application/ports/membership-data-session.js";
import type { TenantProbeRepositoryPort } from "./tenant-probe-repository.port.js";

export interface TenantDataSession extends MembershipDataSession, TenantRbacDataSession {
  readonly tenantProbes: TenantProbeRepositoryPort;
}

export interface TenantTransactionPort {
  run<T>(
    context: TenantExecutionContext | AuthorizedTenantExecutionContext,
    work: (session: TenantDataSession) => Promise<T>,
  ): Promise<T>;
}
