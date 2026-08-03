import type { HealthResponse } from "@booking-os/contracts/health";
import { Controller, Get, Inject } from "@nestjs/common";

import { HealthService } from "./health.service.js";

@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get("health")
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }

  @Get("ready")
  getReadiness(): HealthResponse {
    return this.healthService.getReadiness();
  }
}
