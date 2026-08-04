import type { HealthDependencyStatus } from "@booking-os/contracts";

import type { MonotonicClock } from "../observability/tokens.js";
import type { RedisClientPort } from "./ports.js";
import { classifyReadinessError } from "./readiness-failure.js";
import { measureLatency, type ReadinessProbe } from "./readiness-probe.js";

export class RedisReadinessProbe implements ReadinessProbe {
  readonly dependency = "redis";

  constructor(
    private readonly client: RedisClientPort,
    private readonly now: MonotonicClock,
  ) {}

  async check(): Promise<HealthDependencyStatus> {
    const startedAt = this.now();

    try {
      const reply = await this.client.ping();
      const latencyMs = measureLatency(startedAt, this.now());

      if (reply === "PONG") {
        return { status: "ok", latencyMs };
      }

      return {
        status: "unavailable",
        latencyMs,
        message: "unexpected_response",
      };
    } catch (error) {
      return {
        status: "unavailable",
        latencyMs: measureLatency(startedAt, this.now()),
        message: classifyReadinessError(error),
      };
    }
  }
}
