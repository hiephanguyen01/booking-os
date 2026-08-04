import { Inject, Injectable, type OnApplicationShutdown } from "@nestjs/common";

import { API_LOGGER_TOKEN, type ApiLogger } from "../observability/tokens.js";
import type { PostgresPoolPort, RedisClientPort } from "./ports.js";
import { POSTGRES_POOL_TOKEN, REDIS_CLIENT_TOKEN } from "./tokens.js";

@Injectable()
export class DependencyLifecycleService implements OnApplicationShutdown {
  private closePromise?: Promise<void>;

  constructor(
    @Inject(POSTGRES_POOL_TOKEN) private readonly postgres: PostgresPoolPort,
    @Inject(REDIS_CLIENT_TOKEN) private readonly redis: RedisClientPort,
    @Inject(API_LOGGER_TOKEN) private readonly logger: ApiLogger,
  ) {}

  close(): Promise<void> {
    this.closePromise ??= this.closeResources();
    return this.closePromise;
  }

  onApplicationShutdown(): Promise<void> {
    return this.close();
  }

  private async closeResources(): Promise<void> {
    await this.closePostgres();
    await this.closeRedis();
  }

  private async closePostgres(): Promise<void> {
    try {
      await this.postgres.end();
    } catch (error) {
      this.logger.error("dependency.shutdown_failed", error, {
        dependency: "postgresql",
      });
    }
  }

  private async closeRedis(): Promise<void> {
    if (this.redis.status === "end") {
      return;
    }

    try {
      await this.redis.quit();
    } catch (error) {
      this.redis.disconnect(false);
      this.logger.error("dependency.shutdown_failed", error, {
        dependency: "redis",
      });
    }
  }
}
