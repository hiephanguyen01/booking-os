import type { ApiErrorDetails } from "@booking-os/contracts";

export interface ApiErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly statusCode: number;
  readonly details?: ApiErrorDetails;
  readonly cause?: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: ApiErrorDetails;

  constructor(options: ApiErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.code = options.code;
    this.statusCode = options.statusCode;

    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}
