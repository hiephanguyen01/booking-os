import { Inject, Injectable } from "@nestjs/common";
import { PrismaService } from "../../../../../database/prisma.service.js";
import { PrismaTenantDataSessionFactory } from "../../../../../database/prisma-tenant-data-session.factory.js";
import type {
  PlatformTenantProvisioningDataSession,
  PlatformTenantProvisioningTransactionContext,
  PlatformTenantProvisioningTransactionPort,
} from "../../../application/ports/platform-tenant-provisioning-transaction.port.js";
import { PrismaIdentityProvisioningAdapter } from "./prisma-identity-provisioning.adapter.js";
import { PrismaTenantOutboxAdapter } from "./prisma-tenant-outbox.adapter.js";
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
      const identity = new PrismaIdentityProvisioningAdapter(transaction);
      const context: PlatformTenantProvisioningTransactionContext = Object.freeze({
        idempotency,
        identity,
        runTenant: async <Result>(
          tenantId: string,
          tenantWork: (session: PlatformTenantProvisioningDataSession) => Promise<Result>,
        ): Promise<Result> => {
          await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${APPLICATION_DATABASE_ROLE}`);

          try {
            await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
            const dataSession = this.sessionFactory.create(transaction, tenantId);
            const session: PlatformTenantProvisioningDataSession = Object.freeze({
              ...dataSession,
              outbox: new PrismaTenantOutboxAdapter(transaction, tenantId),
            });
            return await tenantWork(session);
          } finally {
            await transaction.$executeRawUnsafe("SET LOCAL ROLE NONE");
          }
        },
      });

      return work(context);
    });
  }
}
