import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { TenantContextService } from "./tenant-context.service.js";
import { TenantProbeController } from "./tenant-probe.controller.js";
import { TenantResolutionMiddleware } from "./tenant-resolution.middleware.js";

@Module({
  imports: [DatabaseModule],
  controllers: [TenantProbeController],
  providers: [TenantContextService, TenantResolutionMiddleware],
  exports: [TenantContextService],
})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes(TenantProbeController);
  }
}
