import {
  Controller,
  Get,
  Headers,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";

import { InternalApi } from "../../../../api-visibility/api-visibility.decorator.js";
import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { EnvironmentService } from "../../../../config/environment.service.js";
import type { TenantProbeRecord } from "../../application/ports/tenant-probe-repository.port.js";
import { requireTenantExecutionContext } from "../../application/tenant-execution-context.js";
import { ListTenantProbesUseCase } from "../../application/use-cases/list-tenant-probes.use-case.js";
import { TenantRequired } from "./tenant-required.decorator.js";

const FOUNDATION_PROBE_AUTHORIZATION = "Bearer foundation-probe";

@InternalApi()
@TenantRequired()
@Controller("foundation/tenant-probes")
export class TenantProbeController {
  private readonly environment: EnvironmentService;
  private readonly listTenantProbes: ListTenantProbesUseCase;
  private readonly requestContext: RequestContextStorage;

  constructor(
    @Inject(EnvironmentService) environment: EnvironmentService,
    @Inject(ListTenantProbesUseCase) listTenantProbes: ListTenantProbesUseCase,
    @Inject(RequestContextStorage) requestContext: RequestContextStorage,
  ) {
    this.environment = environment;
    this.listTenantProbes = listTenantProbes;
    this.requestContext = requestContext;
  }

  @Get()
  async list(
    @Headers("authorization") authorization: string | undefined,
  ): Promise<readonly TenantProbeRecord[]> {
    if (!this.environment.isTest) {
      throw new NotFoundException();
    }
    if (authorization !== FOUNDATION_PROBE_AUTHORIZATION) {
      throw new UnauthorizedException();
    }

    const context = requireTenantExecutionContext(this.requestContext.require());
    return this.listTenantProbes.execute(context);
  }
}
