import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { SESSION_REQUIRED_METADATA } from "./session-required.decorator.js";

@Injectable()
export class SessionRequiredGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(RequestContextStorage)
    private readonly requestContext: RequestContextStorage,
  ) {}

  canActivate(context: ExecutionContext): boolean {
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
