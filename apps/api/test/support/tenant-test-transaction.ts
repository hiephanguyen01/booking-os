import type { Prisma } from "@prisma/client";

import type { PrismaService } from "../../src/database/prisma.service.js";
import { assertTenantId } from "../../src/modules/tenancy/domain/tenant-id.js";

const APPLICATION_DATABASE_ROLE = "booking_app";

export async function runTenantTestTransaction<T>(
  prisma: PrismaService,
  tenantId: string,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  assertTenantId(tenantId);

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRawUnsafe(`SET LOCAL ROLE ${APPLICATION_DATABASE_ROLE}`);
    await transaction.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return work(transaction);
  });
}
