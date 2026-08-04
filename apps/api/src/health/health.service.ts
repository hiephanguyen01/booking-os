import type { HealthResponse } from "@booking-os/contracts/health";
import { Inject, Injectable } from "@nestjs/common";

import { HealthResponseFactory } from "./health-response.factory.js";
import { ReadinessCoordinator, type ReadinessResult } from "./readiness-coordinator.js";

@Injectable()
export class HealthService {
  constructor(
    @Inject(HealthResponseFactory)
    private readonly responses: HealthResponseFactory,
    @Inject(ReadinessCoordinator)
    private readonly readiness: ReadinessCoordinator,
  ) {}

  getHealth(): HealthResponse {
    return this.responses.createHealth();
  }

  getReadiness(requestId?: string): Promise<ReadinessResult> {
    return this.readiness.getReadiness(requestId);
  }
}
