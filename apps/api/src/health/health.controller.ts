import type { HealthResponse } from "@booking-os/contracts/health";
import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import {
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from "@nestjs/swagger";

import { SupportedApi } from "../api-visibility/api-visibility.decorator.js";
import type { RequestWithContext } from "../observability/request-context.js";
import { HealthDependencyStatusDto, HealthResponseDto } from "../openapi/health-openapi.dto.js";
import { HealthService } from "./health.service.js";

interface HttpStatusResponse {
  status(statusCode: number): unknown;
}

@ApiTags("system")
@ApiExtraModels(HealthDependencyStatusDto)
@SupportedApi()
@Controller()
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get("health")
  @ApiOperation({ operationId: "getHealth" })
  @ApiOkResponse({ type: HealthResponseDto })
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }

  @Get("ready")
  @ApiOperation({ operationId: "getReadiness" })
  @ApiOkResponse({ type: HealthResponseDto })
  @ApiServiceUnavailableResponse({ type: HealthResponseDto })
  async getReadiness(
    @Req() request: RequestWithContext,
    @Res({ passthrough: true }) response: HttpStatusResponse,
  ): Promise<HealthResponse> {
    const result = await this.healthService.getReadiness(request.requestId);

    response.status(result.statusCode);
    return result.body;
  }
}
