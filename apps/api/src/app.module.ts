import { Module } from "@nestjs/common";

import { RequestContextModule } from "./common/request-context/request-context.module.js";
import { EnvironmentModule } from "./config/environment.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { ReliabilityModule } from "./reliability/reliability.module.js";
import { TenancyModule } from "./tenancy/tenancy.module.js";

@Module({
  imports: [
    EnvironmentModule,
    RequestContextModule,
    DatabaseModule,
    HealthModule,
    TenancyModule,
    ReliabilityModule,
  ],
})
export class AppModule {}
