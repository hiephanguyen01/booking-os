import type { HealthResponse } from "@booking-os/contracts/health";
import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import type { Response } from "express";

import type { RequestWithContext } from "../observability/request-context.js";
import { HealthService } from "./health.service.js";

@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get("health")
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }

  @Get("ready")
  async getReadiness(
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponse> {
    const result = await this.healthService.getReadiness(request.requestId);

    response.status(result.statusCode);
    return result.body;
  }
}
