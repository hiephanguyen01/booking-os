import { AsyncLocalStorage } from "node:async_hooks";

import type { Prisma } from "@prisma/client";
import { Inject, Injectable } from "@nestjs/common";

import { PrismaService } from "../database/prisma.service.js";
import { assertTenantId, type TenantContext } from "./tenant-context.js";

const APPLICATION_DATABASE_ROLE = "booking_app";

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantContext>();

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  runWithResolvedTenant<T>(tenantId: string, work: () => T): T {
    assertTenantId(tenantId);
    return this.storage.run(Object.freeze({ tenantId }), work);
  }

  get(): TenantContext | undefined {
    return this.storage.getStore();
  }

  requireTenantId(): string {
    const tenantId = this.get()?.tenantId;

    if (!tenantId) {
      throw new Error("Tenant context is unavailable.");
    }

    return tenantId;
  }

  async runInTenant<T>(
    tenantId: string,
    work: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    assertTenantId(tenantId);

    return this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${APPLICATION_DATABASE_ROLE}`);
      await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return work(transaction);
    });
  }

  runInCurrentTenant<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.runInTenant(this.requireTenantId(), work);
  }
}
