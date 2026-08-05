import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { TENANT_REQUIRED_METADATA } from "./tenant-required.decorator.js";

@Injectable()
export class TenantRequiredGuard implements CanActivate {
  private readonly reflector: Reflector;
  private readonly requestContext: RequestContextStorage;

  constructor(
    @Inject(Reflector) reflector: Reflector,
    @Inject(RequestContextStorage) requestContext: RequestContextStorage,
  ) {
    this.reflector = reflector;
    this.requestContext = requestContext;
  }

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(TENANT_REQUIRED_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }
    if (!this.requestContext.get()?.tenantId) {
      throw new NotFoundException("Tenant context could not be resolved");
    }

    return true;
  }
}
