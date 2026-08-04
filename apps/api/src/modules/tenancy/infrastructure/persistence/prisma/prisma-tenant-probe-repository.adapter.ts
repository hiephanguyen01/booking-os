import type { Prisma } from "@prisma/client";

import type {
  TenantProbeRecord,
  TenantProbeRepositoryPort,
} from "../../../application/ports/tenant-probe-repository.port.js";

export class PrismaTenantProbeRepositoryAdapter implements TenantProbeRepositoryPort {
  private readonly transaction: Prisma.TransactionClient;

  constructor(transaction: Prisma.TransactionClient) {
    this.transaction = transaction;
  }

  list(): Promise<readonly TenantProbeRecord[]> {
    return this.transaction.tenantProbe.findMany({
      orderBy: { id: "asc" },
      select: { id: true, tenantId: true, value: true },
    });
  }
}
