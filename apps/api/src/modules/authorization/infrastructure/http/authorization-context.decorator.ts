import type { AuthorizationContext } from "@booking-os/contracts";
import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import { authorizationContextFromRequest } from "./permission.guard.js";

export const CurrentAuthorizationContext = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthorizationContext =>
    authorizationContextFromRequest(context.switchToHttp().getRequest<object>()),
);
