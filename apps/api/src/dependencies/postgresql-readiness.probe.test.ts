import assert from "node:assert/strict";
import test from "node:test";
import type { PostgresPoolPort } from "./ports.js";
import { PostgreSQLReadinessProbe } from "./postgresql-readiness.probe.js";

function createClock(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

test("queries PostgreSQL once and returns measured readiness", async () => {
  const queries: string[] = [];
  const pool: PostgresPoolPort = {
    query: async (query) => {
      queries.push(query);
      return { rows: [{ ready: 1 }] };
    },
    end: async () => undefined,
    on() {
      return this;
    },
  };
  const probe = new PostgreSQLReadinessProbe(pool, createClock(10, 11.23456));

  assert.equal(probe.dependency, "postgresql");
  assert.deepEqual(await probe.check(), {
    status: "ok",
    latencyMs: 1.235,
  });
  assert.deepEqual(queries, ["SELECT 1 AS ready"]);
});

test("rejects unexpected PostgreSQL result shapes safely", async () => {
  const pool: PostgresPoolPort = {
    query: async () => ({ rows: [{ ready: 1 }, { ready: 1 }] }),
    end: async () => undefined,
    on() {
      return this;
    },
  };

  assert.deepEqual(await new PostgreSQLReadinessProbe(pool, createClock(1, 2)).check(), {
    status: "unavailable",
    latencyMs: 1,
    message: "unexpected_response",
  });
});

test("classifies PostgreSQL connection failures without raw details", async () => {
  const pool: PostgresPoolPort = {
    query: async () => {
      throw Object.assign(new Error("internal database endpoint detail"), {
        code: "ECONNREFUSED",
      });
    },
    end: async () => undefined,
    on() {
      return this;
    },
  };
  const result = await new PostgreSQLReadinessProbe(pool, createClock(4, 5.5)).check();

  assert.deepEqual(result, {
    status: "unavailable",
    latencyMs: 1.5,
    message: "connection_failed",
  });
  assert.equal(JSON.stringify(result).includes("internal database endpoint detail"), false);
});
