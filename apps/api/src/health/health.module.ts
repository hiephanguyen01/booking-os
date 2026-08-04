import { Module } from "@nestjs/common";

import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import {
  DependencyProbe,
  ReadinessChecker,
  TcpDependencyProbe,
} from "./readiness-checker.js";

@Module({
  controllers: [HealthController],
  providers: [
    {
      provide: DependencyProbe,
      useClass: TcpDependencyProbe,
    },
    ReadinessChecker,
    HealthService,
  ],
})
export class HealthModule {}
