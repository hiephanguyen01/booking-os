import type { EventEmitter } from "node:events";

import type { StructuredLogger } from "@booking-os/observability";
import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from "@nestjs/common";
import type { Observable } from "rxjs";

import { EnvironmentService } from "../config/environment.service.js";
import type { RequestWithContext } from "./request-context.js";
import {
  isSuccessfulHealthRoute,
  type RoutableRequest,
  resolveRequestRoute,
} from "./route-resolver.js";
import {
  API_LOGGER_TOKEN,
  MONOTONIC_CLOCK_TOKEN,
  type MonotonicClock,
} from "./tokens.js";

interface LoggingRequest extends RequestWithContext, RoutableRequest {}

interface LoggingResponse extends EventEmitter {
  readonly statusCode: number;
}

function roundDuration(value: number): number {
  return Math.max(0, Math.round(value * 1000) / 1000);
}

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  constructor(
    @Inject(API_LOGGER_TOKEN) private readonly logger: StructuredLogger,
    @Inject(MONOTONIC_CLOCK_TOKEN) private readonly clock: MonotonicClock,
    private readonly environment: EnvironmentService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<LoggingRequest>();
    const response = context.switchToHttp().getResponse<LoggingResponse>();
    const startedAt = this.clock();
    let logged = false;

    response.once("finish", () => {
      if (logged) {
        return;
      }

      logged = true;

      const route = resolveRequestRoute(request);
      const statusCode = response.statusCode;

      if (isSuccessfulHealthRoute(route, statusCode, this.environment.apiPrefix)) {
        return;
      }

      const eventContext = {
        method: request.method ?? "UNKNOWN",
        route,
        statusCode,
        durationMs: roundDuration(this.clock() - startedAt),
      };
      const requestLogger = this.logger.child({ requestId: request.requestId });

      if (statusCode >= 500) {
        requestLogger.warn("http.request_completed", eventContext);
        return;
      }

      requestLogger.info("http.request_completed", eventContext);
    });

    return next.handle();
  }
}
