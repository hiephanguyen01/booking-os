import type { ApiErrorDetails, ApiErrorEnvelope } from "@booking-os/contracts";
import type { StructuredLogger } from "@booking-os/observability";
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from "@nestjs/common";

import type { RequestContextStorage } from "../request-context/request-context.storage.js";
import { ApiError } from "./api-error.js";

interface HttpResponse {
  status(code: number): HttpResponse;
  json(body: ApiErrorEnvelope): HttpResponse;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function httpErrorCode(statusCode: number): string {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return "BAD_REQUEST";
    case HttpStatus.UNAUTHORIZED:
      return "UNAUTHORIZED";
    case HttpStatus.FORBIDDEN:
      return "FORBIDDEN";
    case HttpStatus.NOT_FOUND:
      return "NOT_FOUND";
    case HttpStatus.CONFLICT:
      return "CONFLICT";
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return "VALIDATION_ERROR";
    case HttpStatus.TOO_MANY_REQUESTS:
      return "RATE_LIMITED";
    default:
      return "HTTP_ERROR";
  }
}

function detailsFrom(value: unknown): ApiErrorDetails | undefined {
  return isRecord(value) ? value : undefined;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly requestContext: RequestContextStorage,
    private readonly logger: StructuredLogger,
  ) {}

  format(exception: unknown, requestId: string): ApiErrorEnvelope {
    if (exception instanceof ApiError) {
      return {
        error: {
          code: exception.code,
          message: exception.message,
          requestId,
          ...(exception.details === undefined ? {} : { details: exception.details }),
        },
      };
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();

      if (isRecord(response)) {
        const messages = Array.isArray(response.message)
          ? response.message.filter((message): message is string => typeof message === "string")
          : undefined;

        if (messages && messages.length > 0) {
          return {
            error: {
              code: "VALIDATION_ERROR",
              message: "Request validation failed.",
              requestId,
              details: { messages },
            },
          };
        }

        const code =
          typeof response.code === "string" ? response.code : httpErrorCode(exception.getStatus());
        const message =
          typeof response.message === "string"
            ? response.message
            : "The request could not be completed.";
        const details = detailsFrom(response.details);

        return {
          error: {
            code,
            message,
            requestId,
            ...(details === undefined ? {} : { details }),
          },
        };
      }

      return {
        error: {
          code: httpErrorCode(exception.getStatus()),
          message: typeof response === "string" ? response : exception.message,
          requestId,
        },
      };
    }

    return {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
        requestId,
      },
    };
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = this.requestContext.get();
    const requestId = context?.requestId ?? "unknown";
    const statusCode =
      exception instanceof ApiError
        ? exception.statusCode
        : exception instanceof HttpException
          ? exception.getStatus()
          : HttpStatus.INTERNAL_SERVER_ERROR;

    if (!(exception instanceof ApiError) && !(exception instanceof HttpException)) {
      this.logger.error("http.request.failed", exception, {
        requestId,
        statusCode,
        ...(context?.traceId === undefined ? {} : { traceId: context.traceId }),
      });
    }

    const response = host.switchToHttp().getResponse<HttpResponse>();
    response.status(statusCode).json(this.format(exception, requestId));
  }
}
