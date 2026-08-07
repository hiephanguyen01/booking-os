import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module.js";
import { ProvisionTenantUseCase } from "./application/use-cases/provision-tenant.use-case.js";

@Module({
  imports: [DatabaseModule],
  providers: [ProvisionTenantUseCase],
})
export class MembershipsModule {}
