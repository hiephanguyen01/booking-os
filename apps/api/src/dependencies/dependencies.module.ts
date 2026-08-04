import { Module } from "@nestjs/common";

import { EnvironmentService } from "../config/environment.service.js";
import { ObservabilityModule } from "../observability/observability.module.js";
import { MONOTONIC_CLOCK_TOKEN, type MonotonicClock } from "../observability/tokens.js";
import { createPostgresPool, createRedisClient } from "./dependency-clients.js";
import { DependencyLifecycleService } from "./dependency-lifecycle.service.js";
import type { PostgresPoolPort, RedisClientPort } from "./ports.js";
import { PostgreSQLReadinessProbe } from "./postgresql-readiness.probe.js";
import { RedisReadinessProbe } from "./redis-readiness.probe.js";
import {
  POSTGRES_POOL_TOKEN,
  POSTGRES_READINESS_PROBE_TOKEN,
  REDIS_CLIENT_TOKEN,
  REDIS_READINESS_PROBE_TOKEN,
} from "./tokens.js";

@Module({
  imports: [ObservabilityModule],
  providers: [
    {
      provide: POSTGRES_POOL_TOKEN,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService) => createPostgresPool(environment),
    },
    {
      provide: REDIS_CLIENT_TOKEN,
      inject: [EnvironmentService],
      useFactory: (environment: EnvironmentService) => createRedisClient(environment),
    },
    {
      provide: POSTGRES_READINESS_PROBE_TOKEN,
      inject: [POSTGRES_POOL_TOKEN, MONOTONIC_CLOCK_TOKEN],
      useFactory: (pool: PostgresPoolPort, now: MonotonicClock) =>
        new PostgreSQLReadinessProbe(pool, now),
    },
    {
      provide: REDIS_READINESS_PROBE_TOKEN,
      inject: [REDIS_CLIENT_TOKEN, MONOTONIC_CLOCK_TOKEN],
      useFactory: (client: RedisClientPort, now: MonotonicClock) =>
        new RedisReadinessProbe(client, now),
    },
    DependencyLifecycleService,
  ],
  exports: [POSTGRES_READINESS_PROBE_TOKEN, REDIS_READINESS_PROBE_TOKEN],
})
export class DependenciesModule {}
