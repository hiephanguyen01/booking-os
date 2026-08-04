import type { HealthDependencyStatus, HealthResponse } from "@booking-os/contracts";
import type { StructuredLogger } from "@booking-os/observability";

import type { EnvironmentService } from "../config/environment.service.js";
import type { ReadinessFailureReason, ReadinessProbe } from "../dependencies/readiness-probe.js";
import type { MonotonicClock } from "../observability/tokens.js";
import type { HealthResponseFactory } from "./health-response.factory.js";
import {
  ReadinessTimeoutError,
  type ReadinessTimerScheduler,
  withReadinessTimeout,
} from "./readiness-timeout.js";

const READINESS_CACHE_TTL_MS = 1000;

export interface ReadinessResult {
  readonly statusCode: 200 | 503;
  readonly body: HealthResponse;
}

interface CachedReadiness {
  readonly expiresAt: number;
  readonly result: ReadinessResult;
}

export class ReadinessCoordinator {
  private cachedResult: CachedReadiness | undefined;
  private inFlight: Promise<ReadinessResult> | undefined;

  constructor(
    private readonly postgresProbe: ReadinessProbe,
    private readonly redisProbe: ReadinessProbe,
    private readonly environment: EnvironmentService,
    private readonly responseFactory: HealthResponseFactory,
    private readonly logger: StructuredLogger,
    private readonly now: MonotonicClock,
    private readonly scheduler?: ReadinessTimerScheduler,
  ) {}

  async getReadiness(requestId?: string): Promise<ReadinessResult> {
    const now = this.now();

    if (this.cachedResult && this.cachedResult.expiresAt > now) {
      return this.cachedResult.result;
    }

    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.runProbes(requestId)
      .then((result) => {
        this.cachedResult = {
          expiresAt: this.now() + READINESS_CACHE_TTL_MS,
          result,
        };
        return result;
      })
      .finally(() => {
        this.inFlight = undefined;
      });

    return this.inFlight;
  }

  private async runProbes(requestId?: string): Promise<ReadinessResult> {
    const postgresResultPromise = this.checkProbe(this.postgresProbe, requestId);
    const redisResultPromise = this.checkProbe(this.redisProbe, requestId);
    const [postgresql, redis] = await Promise.all([postgresResultPromise, redisResultPromise]);
    const dependencies = { postgresql, redis };
    const isReady = postgresql.status === "ok" && redis.status === "ok";

    return {
      statusCode: isReady ? 200 : 503,
      body: this.responseFactory.createReadiness(isReady ? "ok" : "unavailable", dependencies),
    };
  }

  private async checkProbe(
    probe: ReadinessProbe,
    requestId?: string,
  ): Promise<HealthDependencyStatus> {
    let result: HealthDependencyStatus;

    try {
      const operation = probe.check();
      result = await (this.scheduler
        ? withReadinessTimeout(operation, this.environment.readinessTimeoutMs, this.scheduler)
        : withReadinessTimeout(operation, this.environment.readinessTimeoutMs));
    } catch (error: unknown) {
      if (!(error instanceof ReadinessTimeoutError)) {
        throw error;
      }

      result = {
        status: "unavailable",
        latencyMs: this.environment.readinessTimeoutMs,
        message: "timeout",
      };
    }

    if (result.status !== "ok") {
      const reason = toFailureReason(result.message);
      const logger = requestId === undefined ? this.logger : this.logger.child({ requestId });

      logger.warn("readiness.probe_failed", {
        dependency: probe.dependency,
        durationMs: result.latencyMs ?? 0,
        reason,
      });
    }

    return result;
  }
}

function toFailureReason(message: string | undefined): ReadinessFailureReason {
  if (
    message === "timeout" ||
    message === "connection_failed" ||
    message === "unexpected_response"
  ) {
    return message;
  }

  return "unexpected_response";
}
