import type { HealthResponse } from "@booking-os/contracts/health";
import { Inject, Injectable } from "@nestjs/common";

import { EnvironmentService } from "../config/environment.service.js";

@Injectable()
export class HealthService {
  private readonly startedAt = process.hrtime.bigint();

  constructor(
    @Inject(EnvironmentService)
    private readonly environment: EnvironmentService,
  ) {}

  getHealth(): HealthResponse {
    const uptimeNanoseconds = process.hrtime.bigint() - this.startedAt;

    const uptimeSeconds = Number(uptimeNanoseconds) / 1_000_000_000;

    return {
      service: "api",
      status: "ok",
      version: this.environment.appVersion,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(uptimeSeconds),
    };
  }

  getReadiness(): HealthResponse {
    return {
      ...this.getHealth(),
      dependencies: {},
    };
  }
}
