import { Module } from "@nestjs/common";

import { RequestContextModule } from "./common/request-context/request-context.module.js";
import { EnvironmentModule } from "./config/environment.module.js";
import { HealthModule } from "./health/health.module.js";

@Module({
  imports: [EnvironmentModule, RequestContextModule, HealthModule],
})
export class AppModule {}
