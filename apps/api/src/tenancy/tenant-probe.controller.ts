import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

import { EnvironmentService } from "../config/environment.service.js";
import { TenantContextService } from "./tenant-context.service.js";

interface TenantProbeResponse {
  readonly id: string;
  readonly tenantId: string;
  readonly value: string;
}

const FOUNDATION_PROBE_AUTHORIZATION = "Bearer foundation-probe";

@Controller("foundation/tenant-probes")
export class TenantProbeController {
  constructor(
    @Inject(EnvironmentService) private readonly environment: EnvironmentService,
    @Inject(TenantContextService) private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  async list(
    @Headers("authorization") authorization: string | undefined,
  ): Promise<readonly TenantProbeResponse[]> {
    if (!this.environment.isTest) {
      throw new NotFoundException();
    }

    if (authorization !== FOUNDATION_PROBE_AUTHORIZATION) {
      throw new UnauthorizedException();
    }

    return this.tenantContext.runInCurrentTenant((transaction) =>
      transaction.tenantProbe.findMany({
        orderBy: { id: "asc" },
        select: { id: true, tenantId: true, value: true },
      }),
    );
  }
}
