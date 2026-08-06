import type {
  LoginAbuseDelayBucket,
  LoginAbuseMetric,
  LoginAbuseMetricsPort,
} from "../../application/ports/login-abuse-metrics.port.js";
import type {
  LoginAbuseProtectionPort,
  LoginAttemptKey,
} from "../../application/ports/login-abuse-protection.port.js";

const DEFAULT_KEY_PREFIX = "booking:login-abuse";
const DEFAULT_TTL_MS = 15 * 60 * 1000;
const DEFAULT_BASE_DELAY_MS = 250;
const DEFAULT_MAX_DELAY_MS = 8_000;

const NOOP_LOGIN_ABUSE_METRICS: LoginAbuseMetricsPort = Object.freeze({
  record: (): void => undefined,
});

const READ_DELAY_SCRIPT = `
local values = redis.call('MGET', KEYS[1], KEYS[2], KEYS[3])
local failures = 0
for index = 1, 3 do
  local value = tonumber(values[index]) or 0
  if value > failures then failures = value end
end
if failures <= 0 then return 0 end
local baseDelay = tonumber(ARGV[1])
local maxDelay = tonumber(ARGV[2])
local delay = baseDelay * (2 ^ (failures - 1))
if delay > maxDelay then return maxDelay end
return math.floor(delay)
`;

const RECORD_FAILURE_SCRIPT = `
local highest = 0
local ttl = tonumber(ARGV[1])
for index = 1, 3 do
  local value = redis.call('INCR', KEYS[index])
  redis.call('PEXPIRE', KEYS[index], ttl)
  if value > highest then highest = value end
end
return highest
`;

const RECORD_SUCCESS_SCRIPT = `
local ttl = tonumber(ARGV[1])
for index = 1, 3 do
  local value = tonumber(redis.call('GET', KEYS[index])) or 0
  if value <= 1 then
    redis.call('DEL', KEYS[index])
  else
    redis.call('DECR', KEYS[index])
    redis.call('PEXPIRE', KEYS[index], ttl)
  end
end
return 0
`;

export interface LoginAbuseRedisClient {
  eval(script: string, numberOfKeys: number, ...args: string[]): Promise<unknown>;
}

export interface RedisLoginAbuseProtectionOptions {
  readonly keyPrefix?: string;
  readonly ttlMs?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

export interface LoginDelayOptions {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export class LoginAbuseProtectionUnavailableError extends Error {
  override readonly name = "LoginAbuseProtectionUnavailableError";
  override readonly cause: unknown;

  constructor(cause: unknown) {
    super("Login abuse protection is unavailable.");
    this.cause = cause;
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

export function calculateLoginDelayMs(failureCount: number, options: LoginDelayOptions): number {
  if (!Number.isSafeInteger(failureCount) || failureCount < 0) {
    throw new RangeError("Login failure count must be a non-negative safe integer.");
  }
  assertPositiveInteger(options.baseDelayMs, "Base login delay");
  assertPositiveInteger(options.maxDelayMs, "Maximum login delay");
  if (options.baseDelayMs > options.maxDelayMs) {
    throw new RangeError("Base login delay cannot exceed the maximum login delay.");
  }
  if (failureCount === 0) {
    return 0;
  }
  if (failureCount >= 32) {
    return options.maxDelayMs;
  }
  return Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (failureCount - 1));
}

function redisKeys(prefix: string, input: LoginAttemptKey): readonly [string, string, string] {
  return [
    `${prefix}:account:${input.accountDigest}`,
    `${prefix}:source:${input.sourceDigest}`,
    `${prefix}:combined:${input.combinedDigest}`,
  ];
}

function delayBucket(delayMs: number): LoginAbuseDelayBucket {
  if (delayMs === 0) {
    return "none";
  }
  if (delayMs < 1_000) {
    return "lt_1s";
  }
  if (delayMs < 4_000) {
    return "1_4s";
  }
  return "gte_4s";
}

export class RedisLoginAbuseProtectionAdapter implements LoginAbuseProtectionPort {
  private readonly keyPrefix: string;
  private readonly ttlMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(
    private readonly redis: LoginAbuseRedisClient,
    options: RedisLoginAbuseProtectionOptions = {},
    private readonly metrics: LoginAbuseMetricsPort = NOOP_LOGIN_ABUSE_METRICS,
  ) {
    this.keyPrefix = options.keyPrefix ?? DEFAULT_KEY_PREFIX;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

    if (this.keyPrefix.trim().length === 0 || /\s/.test(this.keyPrefix)) {
      throw new TypeError("Login abuse Redis key prefix must be non-empty and whitespace-free.");
    }
    assertPositiveInteger(this.ttlMs, "Login abuse TTL");
    calculateLoginDelayMs(1, {
      baseDelayMs: this.baseDelayMs,
      maxDelayMs: this.maxDelayMs,
    });
  }

  private recordMetric(metric: LoginAbuseMetric): void {
    try {
      this.metrics.record(metric);
    } catch {
      // Authentication availability must not depend on telemetry delivery.
    }
  }

  async beforeAttempt(input: LoginAttemptKey): Promise<{ readonly delayMs: number }> {
    const keys = redisKeys(this.keyPrefix, input);
    try {
      const result = await this.redis.eval(
        READ_DELAY_SCRIPT,
        keys.length,
        ...keys,
        String(this.baseDelayMs),
        String(this.maxDelayMs),
      );
      const delayMs = Number(result);
      if (!Number.isSafeInteger(delayMs) || delayMs < 0) {
        throw new TypeError("Redis returned an invalid login delay.");
      }
      const boundedDelayMs = Math.min(delayMs, this.maxDelayMs);
      this.recordMetric({
        purpose: "before_attempt",
        outcome: boundedDelayMs === 0 ? "allowed" : "delayed",
        delayBucket: delayBucket(boundedDelayMs),
        availability: "available",
      });
      return { delayMs: boundedDelayMs };
    } catch (error) {
      this.recordMetric({
        purpose: "before_attempt",
        outcome: "unavailable",
        delayBucket: "none",
        availability: "unavailable",
      });
      if (error instanceof LoginAbuseProtectionUnavailableError) {
        throw error;
      }
      throw new LoginAbuseProtectionUnavailableError(error);
    }
  }

  async recordFailure(input: LoginAttemptKey): Promise<void> {
    const keys = redisKeys(this.keyPrefix, input);
    try {
      await this.redis.eval(RECORD_FAILURE_SCRIPT, keys.length, ...keys, String(this.ttlMs));
      this.recordMetric({
        purpose: "record_failure",
        outcome: "failure",
        delayBucket: "none",
        availability: "available",
      });
    } catch (error) {
      this.recordMetric({
        purpose: "record_failure",
        outcome: "unavailable",
        delayBucket: "none",
        availability: "unavailable",
      });
      throw new LoginAbuseProtectionUnavailableError(error);
    }
  }

  async recordSuccess(input: LoginAttemptKey): Promise<void> {
    const keys = redisKeys(this.keyPrefix, input);
    try {
      await this.redis.eval(RECORD_SUCCESS_SCRIPT, keys.length, ...keys, String(this.ttlMs));
      this.recordMetric({
        purpose: "record_success",
        outcome: "success",
        delayBucket: "none",
        availability: "available",
      });
    } catch (error) {
      this.recordMetric({
        purpose: "record_success",
        outcome: "unavailable",
        delayBucket: "none",
        availability: "unavailable",
      });
      throw new LoginAbuseProtectionUnavailableError(error);
    }
  }
}
