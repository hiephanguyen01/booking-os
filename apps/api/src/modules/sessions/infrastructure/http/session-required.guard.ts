import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { PATH_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { isInvitationPendingRouteAllowed } from "./invitation-pending-route-policy.js";
import { SESSION_REQUIRED_METADATA } from "./session-required.decorator.js";

interface HttpRouteRequest {
  readonly method?: unknown;
  readonly route?: {
    readonly path?: unknown;
  };
}

function singlePathMetadata(target: Function): string | undefined {
  const value = Reflect.getMetadata(PATH_METADATA, target) as unknown;

  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "string") {
    return value[0];
  }
  return undefined;
}

function normalizeFragment(fragment: string): string {
  if (fragment === "" || fragment === "/") {
    return "";
  }
  return `/${fragment.replace(/^\/+|\/+$/g, "")}`;
}

function applicationRoutePath(context: ExecutionContext): string | undefined {
  const controllerPath = singlePathMetadata(context.getClass());
  const methodPath = singlePathMetadata(context.getHandler());

  if (controllerPath !== undefined && methodPath !== undefined) {
    return `${normalizeFragment(controllerPath)}${normalizeFragment(methodPath)}` || "/";
  }

  const request = context.switchToHttp().getRequest<HttpRouteRequest>();
  return typeof request.route?.path === "string" ? request.route.path : undefined;
}

@Injectable()
export class SessionRequiredGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(RequestContextStorage)
    private readonly requestContext: RequestContextStorage,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requestContext = this.requestContext.get() as
      | { readonly sessionState?: unknown }
      | undefined;

    if (requestContext?.sessionState === "invitation_pending") {
      const request = context.switchToHttp().getRequest<HttpRouteRequest>();
      const path = applicationRoutePath(context);
      if (
        typeof request.method !== "string" ||
        !path ||
        !isInvitationPendingRouteAllowed({ method: request.method, path })
      ) {
        throw new ForbiddenException("Invitation-pending session is not allowed on this route.");
      }
      return true;
    }

    const required = this.reflector.getAllAndOverride<boolean>(SESSION_REQUIRED_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) {
      return true;
    }
    if (!this.requestContext.getAuthenticated()) {
      throw new UnauthorizedException("Authentication is required.");
    }
    return true;
  }
}
