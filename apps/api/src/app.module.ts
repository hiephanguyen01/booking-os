import { Module } from "@nestjs/common";

import { EnvironmentModule } from "./config/environment.module.js";
import { DependenciesModule } from "./dependencies/dependencies.module.js";
import { HealthModule } from "./health/health.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";

@Module({
  imports: [EnvironmentModule, ObservabilityModule, DependenciesModule, HealthModule],
})
export class AppModule {}
