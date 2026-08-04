import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { DatabaseModule } from "../../database/database.module.js";
import type { TenantDirectoryPort } from "./application/ports/tenant-directory.port.js";
import { ResolveTenantUseCase } from "./application/use-cases/resolve-tenant.use-case.js";
import { TenantRequiredGuard } from "./infrastructure/http/tenant-required.guard.js";
import { TenantResolutionMiddleware } from "./infrastructure/http/tenant-resolution.middleware.js";
import { PrismaTenantDirectoryAdapter } from "./infrastructure/persistence/prisma/prisma-tenant-directory.adapter.js";
import { PrismaTenantTransactionAdapter } from "./infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.js";
import { TENANT_DIRECTORY_PORT, TENANT_TRANSACTION_PORT } from "./tenancy.tokens.js";

@Module({
  imports: [DatabaseModule],
  providers: [
    {
      provide: TENANT_DIRECTORY_PORT,
      useClass: PrismaTenantDirectoryAdapter,
    },
    {
      provide: TENANT_TRANSACTION_PORT,
      useClass: PrismaTenantTransactionAdapter,
    },
    {
      provide: ResolveTenantUseCase,
      inject: [TENANT_DIRECTORY_PORT],
      useFactory: (directory: TenantDirectoryPort): ResolveTenantUseCase =>
        new ResolveTenantUseCase(directory),
    },
    TenantResolutionMiddleware,
    TenantRequiredGuard,
    {
      provide: APP_GUARD,
      useExisting: TenantRequiredGuard,
    },
  ],
})
export class TenancyModule {}
