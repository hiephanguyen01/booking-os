import { Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { RequestContextModule } from "./common/request-context/request-context.module.js";
import { EnvironmentModule } from "./config/environment.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { DependenciesModule } from "./dependencies/dependencies.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { SessionsModule } from "./modules/sessions/sessions.module.js";
import { TenancyModule } from "./modules/tenancy/tenancy.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { ReliabilityModule } from "./reliability/reliability.module.js";

@Module({
  imports: [
    DiscoveryModule,
    EnvironmentModule,
    ObservabilityModule,
    RequestContextModule,
    DependenciesModule,
    DatabaseModule,
    HealthModule,
    IdentityModule,
    TenancyModule,
    SessionsModule,
    ReliabilityModule,
  ],
})
export class AppModule {}
