import type { TenantExecutionContext } from "@booking-os/contracts";

import type { TenantProbeRecord } from "../ports/tenant-probe-repository.port.js";
import type { TenantTransactionPort } from "../ports/tenant-transaction.port.js";

export class ListTenantProbesUseCase {
  private readonly transactions: TenantTransactionPort;

  constructor(transactions: TenantTransactionPort) {
    this.transactions = transactions;
  }

  execute(context: TenantExecutionContext): Promise<readonly TenantProbeRecord[]> {
    return this.transactions.run(context, (session) => session.tenantProbes.list());
  }
}
