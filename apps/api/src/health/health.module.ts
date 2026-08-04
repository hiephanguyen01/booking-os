import type { StructuredLogger } from "@booking-os/observability";
import { Module } from "@nestjs/common";

import { EnvironmentService } from "../config/environment.service.js";
import { DependenciesModule } from "../dependencies/dependencies.module.js";
import type { ReadinessProbe } from "../dependencies/readiness-probe.js";
import {
  POSTGRES_READINESS_PROBE_TOKEN,
  REDIS_READINESS_PROBE_TOKEN,
} from "../dependencies/tokens.js";
import {
  API_LOGGER_TOKEN,
  MONOTONIC_CLOCK_TOKEN,
  type MonotonicClock,
  WALL_CLOCK_TOKEN,
  type WallClock,
} from "../observability/tokens.js";
import { HealthController } from "./health.controller.js";
import { HealthService } from "./health.service.js";
import { HealthResponseFactory } from "./health-response.factory.js";
import { ReadinessCoordinator } from "./readiness-coordinator.js";

@Module({
  imports: [DependenciesModule],
  controllers: [HealthController],
  providers: [
    {
      provide: HealthResponseFactory,
      inject: [EnvironmentService, MONOTONIC_CLOCK_TOKEN, WALL_CLOCK_TOKEN],
      useFactory: (
        environment: EnvironmentService,
        monotonicClock: MonotonicClock,
        wallClock: WallClock,
      ) => new HealthResponseFactory(environment, monotonicClock, wallClock),
    },
    {
      provide: ReadinessCoordinator,
      inject: [
        POSTGRES_READINESS_PROBE_TOKEN,
        REDIS_READINESS_PROBE_TOKEN,
        EnvironmentService,
        HealthResponseFactory,
        API_LOGGER_TOKEN,
        MONOTONIC_CLOCK_TOKEN,
      ],
      useFactory: (
        postgresProbe: ReadinessProbe,
        redisProbe: ReadinessProbe,
        environment: EnvironmentService,
        responses: HealthResponseFactory,
        logger: StructuredLogger,
        monotonicClock: MonotonicClock,
      ) =>
        new ReadinessCoordinator(
          postgresProbe,
          redisProbe,
          environment,
          responses,
          logger,
          monotonicClock,
        ),
    },
    HealthService,
  ],
})
export class HealthModule {}
