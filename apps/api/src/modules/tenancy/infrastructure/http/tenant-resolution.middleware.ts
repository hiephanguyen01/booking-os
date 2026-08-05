import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { EnvironmentService } from "../../../../config/environment.service.js";
import { ResolveTenantUseCase } from "../../application/use-cases/resolve-tenant.use-case.js";
import { effectiveHostname, type HostHeaders } from "./effective-hostname.js";

interface HostRequest {
  readonly headers: HostHeaders;
}

type Next = (error?: unknown) => void;

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  private readonly environment: EnvironmentService;
  private readonly resolveTenant: ResolveTenantUseCase;
  private readonly requestContext: RequestContextStorage;

  constructor(
    @Inject(EnvironmentService) environment: EnvironmentService,
    @Inject(ResolveTenantUseCase) resolveTenant: ResolveTenantUseCase,
    @Inject(RequestContextStorage) requestContext: RequestContextStorage,
  ) {
    this.environment = environment;
    this.resolveTenant = resolveTenant;
    this.requestContext = requestContext;
  }

  async use(request: HostRequest, _response: unknown, next: Next): Promise<void> {
    try {
      const hostname = effectiveHostname(request.headers, this.environment.trustProxy);
      if (!hostname) {
        next();
        return;
      }

      const tenant = await this.resolveTenant.execute(hostname);
      if (!tenant) {
        next();
        return;
      }

      const current = this.requestContext.require();
      this.requestContext.run({ ...current, tenantId: tenant.id }, next);
    } catch (error: unknown) {
      next(error);
    }
  }
}
