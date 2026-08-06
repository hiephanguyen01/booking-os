import assert from "node:assert/strict";
import test from "node:test";

import type { LoginAttemptKey } from "../../application/ports/login-abuse-protection.port.js";
import {
  calculateLoginDelayMs,
  LoginAbuseProtectionUnavailableError,
  RedisLoginAbuseProtectionAdapter,
} from "./redis-login-abuse-protection.adapter.js";

const ATTEMPT_KEY: LoginAttemptKey = Object.freeze({
  accountDigest: "a".repeat(64),
  sourceDigest: "b".repeat(64),
  combinedDigest: "c".repeat(64),
  sourceSummary: "ipv4:203.0.113.0/24",
});

interface EvalCall {
  readonly script: string;
  readonly numberOfKeys: number;
  readonly arguments: readonly string[];
}

class FakeRedisClient {
  readonly calls: EvalCall[] = [];
  results: unknown[] = [];
  error: Error | null = null;

  async eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown> {
    this.calls.push({ script, numberOfKeys, arguments: args });
    if (this.error) {
      throw this.error;
    }
    return this.results.shift() ?? 0;
  }
}

function createAdapter(client: FakeRedisClient): RedisLoginAbuseProtectionAdapter {
  return new RedisLoginAbuseProtectionAdapter(client, {
    keyPrefix: "booking:test:login-abuse",
    ttlMs: 15 * 60 * 1000,
    baseDelayMs: 250,
    maxDelayMs: 8_000,
  });
}

test("uses bounded exponential progressive delay", () => {
  assert.equal(calculateLoginDelayMs(0, { baseDelayMs: 250, maxDelayMs: 8_000 }), 0);
  assert.equal(calculateLoginDelayMs(1, { baseDelayMs: 250, maxDelayMs: 8_000 }), 250);
  assert.equal(calculateLoginDelayMs(2, { baseDelayMs: 250, maxDelayMs: 8_000 }), 500);
  assert.equal(calculateLoginDelayMs(6, { baseDelayMs: 250, maxDelayMs: 8_000 }), 8_000);
  assert.equal(calculateLoginDelayMs(50, { baseDelayMs: 250, maxDelayMs: 8_000 }), 8_000);
});

test("reads account, source, and combined counters in one atomic Lua evaluation", async () => {
  const redis = new FakeRedisClient();
  redis.results.push(1_500);
  const adapter = createAdapter(redis);

  assert.deepEqual(await adapter.beforeAttempt(ATTEMPT_KEY), { delayMs: 1_500 });
  assert.equal(redis.calls.length, 1);
  assert.equal(redis.calls[0]?.numberOfKeys, 3);
  assert.deepEqual(redis.calls[0]?.arguments.slice(0, 3), [
    `booking:test:login-abuse:account:${ATTEMPT_KEY.accountDigest}`,
    `booking:test:login-abuse:source:${ATTEMPT_KEY.sourceDigest}`,
    `booking:test:login-abuse:combined:${ATTEMPT_KEY.combinedDigest}`,
  ]);
  assert.match(redis.calls[0]?.script ?? "", /MGET/);
});

test("increments all counters and refreshes their TTL in one Lua call", async () => {
  const redis = new FakeRedisClient();
  const adapter = createAdapter(redis);

  await adapter.recordFailure(ATTEMPT_KEY);

  assert.equal(redis.calls.length, 1);
  assert.equal(redis.calls[0]?.numberOfKeys, 3);
  assert.match(redis.calls[0]?.script ?? "", /INCR/);
  assert.match(redis.calls[0]?.script ?? "", /PEXPIRE/);
  assert.equal(redis.calls[0]?.arguments.at(-1), String(15 * 60 * 1000));
});

test("success atomically decays all three counters without making them negative", async () => {
  const redis = new FakeRedisClient();
  const adapter = createAdapter(redis);

  await adapter.recordSuccess(ATTEMPT_KEY);

  assert.equal(redis.calls.length, 1);
  assert.equal(redis.calls[0]?.numberOfKeys, 3);
  assert.match(redis.calls[0]?.script ?? "", /DECR/);
  assert.match(redis.calls[0]?.script ?? "", /DEL/);
});

test("fails closed when Redis is unavailable", async () => {
  const redis = new FakeRedisClient();
  redis.error = new Error("redis unavailable");
  const adapter = createAdapter(redis);

  await assert.rejects(
    adapter.beforeAttempt(ATTEMPT_KEY),
    (error: unknown) => error instanceof LoginAbuseProtectionUnavailableError,
  );
  await assert.rejects(
    adapter.recordFailure(ATTEMPT_KEY),
    (error: unknown) => error instanceof LoginAbuseProtectionUnavailableError,
  );
  await assert.rejects(
    adapter.recordSuccess(ATTEMPT_KEY),
    (error: unknown) => error instanceof LoginAbuseProtectionUnavailableError,
  );
});
