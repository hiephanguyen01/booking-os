import { STATUS_CODES } from "node:http";

import { HttpException } from "@nestjs/common";

export interface ApiErrorResponseBody {
  readonly statusCode: number;
  readonly error: string;
  readonly message: string | readonly string[];
  readonly requestId: string;
}

export interface ApiErrorResponse {
  readonly statusCode: number;
  readonly body: ApiErrorResponseBody;
}

const INTERNAL_ERROR_MESSAGE = "An unexpected error occurred";

function statusText(statusCode: number): string {
  return STATUS_CODES[statusCode] ?? "Error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeMessage(value: unknown, fallback: string): string | readonly string[] {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return [...value];
  }

  return fallback;
}

export function normalizeApiError(exception: unknown, requestId: string): ApiErrorResponse {
  const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
  const fallback = statusText(statusCode);

  if (statusCode >= 500) {
    return {
      statusCode,
      body: {
        statusCode,
        error: fallback,
        message: INTERNAL_ERROR_MESSAGE,
        requestId,
      },
    };
  }

  const response = exception instanceof HttpException ? exception.getResponse() : undefined;
  const message = typeof response === "string" ? response : safeMessage(isRecord(response) ? response.message : undefined, fallback);
  const error = isRecord(response) && typeof response.error === "string" ? response.error : fallback;

  return {
    statusCode,
    body: {
      statusCode,
      error,
      message,
      requestId,
    },
  };
}
