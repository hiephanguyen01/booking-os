import type {
  AuthorizedTenantExecutionContext,
  TenantExecutionContext,
} from "@booking-os/contracts";

import type { PartnerDataSession } from "./partner-data-session.js";

export interface PartnerTransactionPort {
  run<T>(
    context: TenantExecutionContext | AuthorizedTenantExecutionContext,
    work: (session: PartnerDataSession) => Promise<T>,
  ): Promise<T>;
}
