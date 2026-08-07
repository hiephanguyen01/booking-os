import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";
import { PrismaTenantDataSessionFactory } from "./prisma-tenant-data-session.factory.js";

@Global()
@Module({
  providers: [PrismaService, PrismaTenantDataSessionFactory],
  exports: [PrismaService, PrismaTenantDataSessionFactory],
})
export class DatabaseModule {}
