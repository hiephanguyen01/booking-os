import assert from "node:assert/strict";
import test from "node:test";

import type { RedisClientPort } from "./ports.js";
import { RedisReadinessProbe } from "./redis-readiness.probe.js";

function createClock(...values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? values.at(-1) ?? 0;
}

function createClient(ping: () => Promise<string>): RedisClientPort {
  return {
    status: "ready",
    ping,
    quit: async () => "OK",
    disconnect: () => undefined,
    on() {
      return this;
    },
  };
}

test("accepts only exact uppercase PONG and measures latency", async () => {
  let pingCalls = 0;
  const client = createClient(async () => {
    pingCalls += 1;
    return "PONG";
  });
  const probe = new RedisReadinessProbe(client, createClock(20, 20.98765));

  assert.equal(probe.dependency, "redis");
  assert.deepEqual(await probe.check(), {
    status: "ok",
    latencyMs: 0.988,
  });
  assert.equal(pingCalls, 1);
});

test("maps lowercase and unexpected Redis replies to a safe reason", async () => {
  for (const reply of ["pong", "OK"]) {
    assert.deepEqual(
      await new RedisReadinessProbe(
        createClient(async () => reply),
        createClock(1, 2),
      ).check(),
      {
        status: "unavailable",
        latencyMs: 1,
        message: "unexpected_response",
      },
    );
  }
});

test("classifies Redis connection failures without raw details", async () => {
  const client = createClient(async () => {
    throw Object.assign(new Error("internal Redis endpoint detail"), {
      code: "ETIMEDOUT",
    });
  });
  const result = await new RedisReadinessProbe(client, createClock(3, 4.25)).check();

  assert.deepEqual(result, {
    status: "unavailable",
    latencyMs: 1.25,
    message: "connection_failed",
  });
  assert.equal(JSON.stringify(result).includes("internal Redis endpoint detail"), false);
});
