import { Module } from "@nestjs/common";

import { EnvironmentService } from "../config/environment.service.js";
import { createPostgresPool, createRedisClient } from "./dependency-clients.js";
import { DependencyLifecycleService } from "./dependency-lifecycle.service.js";
import { POSTGRES_POOL_TOKEN, REDIS_CLIENT_TOKEN } from "./tokens.js";

@Module({
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
    DependencyLifecycleService,
  ],
})
export class DependenciesModule {}
