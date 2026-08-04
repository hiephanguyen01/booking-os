import assert from "node:assert/strict";
import test from "node:test";

import type { RedisOptions } from "ioredis";
import type { PoolConfig } from "pg";

import {
  createPostgresPool,
  createRedisClient,
  type DependencyClientEnvironment,
  type PostgresConstructor,
  type RedisConstructor,
} from "./dependency-clients.js";
import type { PostgresPoolPort, RedisClientPort } from "./ports.js";

const environment: DependencyClientEnvironment = {
  databaseUrl: "postgres://localhost/app",
  redisUrl: "redis://localhost:6379",
  readinessTimeoutMs: 750,
};

test("creates a lazy PostgreSQL pool with bounded connection and query timeouts", () => {
  let capturedOptions: PoolConfig | undefined;
  let queryCalls = 0;
  let errorListenerRegistered = false;
  const pool: PostgresPoolPort = {
    query: async () => {
      queryCalls += 1;
      return { rows: [] };
    },
    end: async () => undefined,
    on(event) {
      errorListenerRegistered ||= event === "error";
      return this;
    },
  };
  const construct: PostgresConstructor = (options) => {
    capturedOptions = options;
    return pool;
  };

  assert.equal(createPostgresPool(environment, construct), pool);
  assert.deepEqual(capturedOptions, {
    connectionString: "postgres://localhost/app",
    connectionTimeoutMillis: 750,
    query_timeout: 750,
  });
  assert.equal(queryCalls, 0);
  assert.equal(errorListenerRegistered, true);
});

test("creates a lazy Redis client with bounded commands and retries", () => {
  let capturedUrl: string | undefined;
  let capturedOptions: RedisOptions | undefined;
  let pingCalls = 0;
  let errorListenerRegistered = false;
  const client: RedisClientPort = {
    status: "wait",
    ping: async () => {
      pingCalls += 1;
      return "PONG";
    },
    quit: async () => "OK",
    disconnect: () => undefined,
    on(event) {
      errorListenerRegistered ||= event === "error";
      return this;
    },
  };
  const construct: RedisConstructor = (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return client;
  };

  assert.equal(createRedisClient(environment, construct), client);
  assert.equal(capturedUrl, "redis://localhost:6379");
  assert.deepEqual(capturedOptions, {
    lazyConnect: true,
    connectTimeout: 750,
    commandTimeout: 750,
    maxRetriesPerRequest: 1,
  });
  assert.equal(pingCalls, 0);
  assert.equal(errorListenerRegistered, true);
});
