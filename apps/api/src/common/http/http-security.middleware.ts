import { Inject, Injectable, type NestMiddleware } from "@nestjs/common";

import { EnvironmentService } from "../../config/environment.service.js";
import {
  applyHttpSecurityPolicy,
  type SecurityRequest,
  type SecurityResponse,
} from "./http-security.interceptor.js";

type Next = (error?: unknown) => void;

@Injectable()
export class HttpSecurityMiddleware implements NestMiddleware {
  constructor(@Inject(EnvironmentService) private readonly environment: EnvironmentService) {}

  use(request: SecurityRequest, response: SecurityResponse, next: Next): void {
    applyHttpSecurityPolicy(request, response, this.environment);
    next();
  }
}
