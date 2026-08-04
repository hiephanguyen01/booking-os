import type { HealthDependencyStatus } from "@booking-os/contracts";

import type { MonotonicClock } from "../observability/tokens.js";
import type { PostgresPoolPort } from "./ports.js";
import { classifyReadinessError } from "./readiness-failure.js";
import { measureLatency, type ReadinessProbe } from "./readiness-probe.js";

function isReadyRow(value: unknown): boolean {
  return typeof value === "object" && value !== null && "ready" in value && value.ready === 1;
}

export class PostgreSQLReadinessProbe implements ReadinessProbe {
  readonly dependency = "postgresql";

  constructor(
    private readonly pool: PostgresPoolPort,
    private readonly now: MonotonicClock,
  ) {}

  async check(): Promise<HealthDependencyStatus> {
    const startedAt = this.now();

    try {
      const result = await this.pool.query("SELECT 1 AS ready");
      const latencyMs = measureLatency(startedAt, this.now());

      if (result.rows.length === 1 && isReadyRow(result.rows[0])) {
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
