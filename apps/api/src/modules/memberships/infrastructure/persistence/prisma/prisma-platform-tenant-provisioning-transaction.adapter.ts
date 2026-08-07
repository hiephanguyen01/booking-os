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

function isTransactionAbortedError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P2010" &&
    "meta" in error &&
    typeof error.meta === "object" &&
    error.meta !== null &&
    "code" in error.meta &&
    error.meta.code === "25P02"
  );
}

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

          let result: Result;
          try {
            await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
            const dataSession = this.sessionFactory.create(transaction, tenantId);
            const session: PlatformTenantProvisioningDataSession = Object.freeze({
              ...dataSession,
              outbox: new PrismaTenantOutboxAdapter(transaction, tenantId),
            });
            result = await tenantWork(session);
          } catch (error: unknown) {
            try {
              await transaction.$executeRawUnsafe("SET LOCAL ROLE NONE");
            } catch (resetError: unknown) {
              if (!isTransactionAbortedError(resetError)) throw resetError;
            }
            throw error;
          }

          await transaction.$executeRawUnsafe("SET LOCAL ROLE NONE");
          return result;
        },
      });

      return work(context);
    });
  }
}
