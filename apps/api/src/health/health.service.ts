import type { HealthResponse } from "@booking-os/contracts/health";
import { Injectable } from "@nestjs/common";

@Injectable()
export class HealthService {
  private readonly startedAt = process.hrtime.bigint();

  getHealth(): HealthResponse {
    const uptimeNanoseconds = process.hrtime.bigint() - this.startedAt;
    const uptimeSeconds = Number(uptimeNanoseconds) / 1_000_000_000;

    return {
      service: "api",
      status: "ok",
      version: process.env.npm_package_version ?? "0.1.0",
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
