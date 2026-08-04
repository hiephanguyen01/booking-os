import type { HealthResponse } from "@booking-os/contracts/health";
import { Controller, Get, Inject, Res } from "@nestjs/common";

import { HealthService } from "./health.service.js";

interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: HealthResponse): HttpResponse;
}

@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get("health")
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }

  @Get("ready")
  async getReadiness(@Res() response: HttpResponse): Promise<void> {
    const readiness = await this.healthService.getReadiness();
    const statusCode = readiness.status === "ok" ? 200 : 503;

    response.status(statusCode).json(readiness);
  }
}
