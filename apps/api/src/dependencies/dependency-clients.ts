import Redis, { type RedisOptions } from "ioredis";
import { Pool, type PoolConfig } from "pg";

import type { PostgresPoolPort, RedisClientPort } from "./ports.js";

export interface DependencyClientEnvironment {
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly readinessTimeoutMs: number;
}

export type PostgresConstructor = (options: PoolConfig) => PostgresPoolPort;
export type RedisConstructor = (url: string, options: RedisOptions) => RedisClientPort;

const constructPostgres: PostgresConstructor = (options) => new Pool(options);
const constructRedis: RedisConstructor = (url, options) => new Redis(url, options);

export function createPostgresPool(
  environment: DependencyClientEnvironment,
  construct: PostgresConstructor = constructPostgres,
): PostgresPoolPort {
  const pool = construct({
    connectionString: environment.databaseUrl,
    connectionTimeoutMillis: environment.readinessTimeoutMs,
    query_timeout: environment.readinessTimeoutMs,
  });

  pool.on("error", () => undefined);
  return pool;
}

export function createRedisClient(
  environment: DependencyClientEnvironment,
  construct: RedisConstructor = constructRedis,
): RedisClientPort {
  const client = construct(environment.redisUrl, {
    lazyConnect: true,
    connectTimeout: environment.readinessTimeoutMs,
    commandTimeout: environment.readinessTimeoutMs,
    maxRetriesPerRequest: 1,
  });

  client.on("error", () => undefined);
  return client;
}
