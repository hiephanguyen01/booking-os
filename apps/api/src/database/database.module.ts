import { Global, Module } from "@nestjs/common";

import { PrismaTenantDataSessionFactory } from "./prisma-tenant-data-session.factory.js";
import { PrismaService } from "./prisma.service.js";

@Global()
@Module({
  providers: [PrismaService, PrismaTenantDataSessionFactory],
  exports: [PrismaService, PrismaTenantDataSessionFactory],
})
export class DatabaseModule {}
