import type {
  HealthDependencyStatus,
  HealthResponse,
  HealthStatus,
} from "@booking-os/contracts";

import type { EnvironmentService } from "../config/environment.service.js";
import type { MonotonicClock, WallClock } from "../observability/tokens.js";

export class HealthResponseFactory {
  private readonly startedAt: number;

  constructor(
    private readonly environment: EnvironmentService,
    private readonly now: MonotonicClock,
    private readonly wallClock: WallClock,
  ) {
    this.startedAt = this.now();
  }

  createHealth(): HealthResponse {
    return this.createResponse("ok");
  }

  createReadiness(
    status: Extract<HealthStatus, "ok" | "unavailable">,
    dependencies: Readonly<Record<string, HealthDependencyStatus>>,
  ): HealthResponse {
    return {
      ...this.createResponse(status),
      dependencies,
    };
  }

  private createResponse(status: HealthStatus): HealthResponse {
    const uptimeMilliseconds = Math.max(0, this.now() - this.startedAt);

    return {
      service: "api",
      status,
      version: this.environment.appVersion,
      timestamp: this.wallClock().toISOString(),
      uptimeSeconds: Math.floor(uptimeMilliseconds / 1000),
    };
  }
}
