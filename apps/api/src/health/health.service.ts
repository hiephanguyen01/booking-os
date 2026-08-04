import type { HealthResponse } from "@booking-os/contracts/health";
import { Inject, Injectable } from "@nestjs/common";

import { EnvironmentService } from "../config/environment.service.js";
import { ReadinessChecker } from "./readiness-checker.js";

@Injectable()
export class HealthService {
  private readonly startedAt = process.hrtime.bigint();

  constructor(
    @Inject(EnvironmentService)
    private readonly environment: EnvironmentService,
    @Inject(ReadinessChecker)
    private readonly readinessChecker: ReadinessChecker,
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

  async getReadiness(): Promise<HealthResponse> {
    const dependencies = await this.readinessChecker.check();
    const ready = Object.values(dependencies).every((dependency) => dependency.status === "ok");

    return {
      ...this.getHealth(),
      status: ready ? "ok" : "unavailable",
      dependencies,
    };
  }
}
