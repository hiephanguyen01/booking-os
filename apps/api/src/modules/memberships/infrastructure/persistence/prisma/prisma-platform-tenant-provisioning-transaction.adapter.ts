import { Inject, Injectable } from "@nestjs/common";

import { PrismaTenantDataSessionFactory } from "../../../../../database/prisma-tenant-data-session.factory.js";
import { PrismaService } from "../../../../../database/prisma.service.js";
import type {
  PlatformTenantProvisioningTransactionContext,
  PlatformTenantProvisioningTransactionPort,
} from "../../../application/ports/platform-tenant-provisioning-transaction.port.js";
import { PrismaTenantProvisioningIdempotencyAdapter } from "./prisma-tenant-provisioning-idempotency.adapter.js";

const APPLICATION_DATABASE_ROLE = "booking_app";

@Injectable()
export class PrismaPlatformTenantProvisioningTransactionAdapter
  implements PlatformTenantProvisioningTransactionPort
{
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(PrismaTenantDataSessionFactory)
    private readonly sessionFactory: PrismaTenantDataSessionFactory,
  ) {}

  async run<T>(
    work: (context: PlatformTenantProvisioningTransactionContext) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (transaction) => {
      const idempotency = new PrismaTenantProvisioningIdempotencyAdapter(transaction);
      const context: PlatformTenantProvisioningTransactionContext = Object.freeze({
        idempotency,
        runTenant: async <Result>(
          tenantId: string,
          tenantWork: Parameters<PlatformTenantProvisioningTransactionContext["runTenant"]>[1],
        ): Promise<Result> => {
          await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${APPLICATION_DATABASE_ROLE}`);

          try {
            await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
            const session = this.sessionFactory.create(transaction, tenantId);
            return (await tenantWork(session)) as Result;
          } finally {
            await transaction.$executeRawUnsafe("SET LOCAL ROLE NONE");
          }
        },
      });

      return work(context);
    });
  }
}
