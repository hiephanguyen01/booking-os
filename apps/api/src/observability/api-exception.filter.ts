import { type ArgumentsHost, Catch, type ExceptionFilter, Inject } from "@nestjs/common";

import { normalizeApiError } from "./api-error-response.js";
import type { RequestWithContext } from "./request-context.js";
import { type RoutableRequest, resolveRequestRoute } from "./route-resolver.js";
import { API_LOGGER_TOKEN, type ApiLogger } from "./tokens.js";

interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): ApiResponse;
}

type ApiRequest = RequestWithContext & RoutableRequest;

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(@Inject(API_LOGGER_TOKEN) private readonly logger: ApiLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<ApiRequest>();
    const response = http.getResponse<ApiResponse>();
    const normalized = normalizeApiError(exception, request.requestId);

    this.logger.child({ requestId: request.requestId }).error("http.request_failed", exception, {
      method: request.method ?? "UNKNOWN",
      route: resolveRequestRoute(request),
      statusCode: normalized.statusCode,
    });

    response.status(normalized.statusCode).json(normalized.body);
  }
}
