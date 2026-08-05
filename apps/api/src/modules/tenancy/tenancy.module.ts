import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import { EnvironmentService } from "../../config/environment.service.js";
import { DatabaseModule } from "../../database/database.module.js";
import type { TenantDirectoryPort } from "./application/ports/tenant-directory.port.js";
import type { TenantTransactionPort } from "./application/ports/tenant-transaction.port.js";
import { ListTenantProbesUseCase } from "./application/use-cases/list-tenant-probes.use-case.js";
import { ResolveTenantUseCase } from "./application/use-cases/resolve-tenant.use-case.js";
import { TenantProbeController } from "./infrastructure/http/tenant-probe.controller.js";
import { TenantRequiredGuard } from "./infrastructure/http/tenant-required.guard.js";
import { TenantResolutionMiddleware } from "./infrastructure/http/tenant-resolution.middleware.js";
import { PrismaTenantDirectoryAdapter } from "./infrastructure/persistence/prisma/prisma-tenant-directory.adapter.js";
import { PrismaTenantTransactionAdapter } from "./infrastructure/persistence/prisma/prisma-tenant-transaction.adapter.js";
import { TENANT_DIRECTORY_PORT, TENANT_TRANSACTION_PORT } from "./tenancy.tokens.js";

@Module({
  imports: [DatabaseModule],
  controllers: [TenantProbeController],
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
      inject: [TENANT_DIRECTORY_PORT, EnvironmentService],
      useFactory: (
        directory: TenantDirectoryPort,
        environment: EnvironmentService,
      ): ResolveTenantUseCase => new ResolveTenantUseCase(directory, environment.tenantBaseDomain),
    },
    {
      provide: ListTenantProbesUseCase,
      inject: [TENANT_TRANSACTION_PORT],
      useFactory: (transactions: TenantTransactionPort): ListTenantProbesUseCase =>
        new ListTenantProbesUseCase(transactions),
    },
    TenantResolutionMiddleware,
    TenantRequiredGuard,
    {
      provide: APP_GUARD,
      useExisting: TenantRequiredGuard,
    },
  ],
})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes(TenantProbeController);
  }
}
