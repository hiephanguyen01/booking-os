export type ApiClientErrorCode =
  | "invalid_config"
  | "network"
  | "timeout"
  | "http"
  | "invalid_response";

export interface ApiClientErrorOptions {
  readonly status?: number;
  readonly cause?: unknown;
}

export class ApiClientError extends Error {
  readonly code: ApiClientErrorCode;
  declare readonly status?: number;

  constructor(code: ApiClientErrorCode, message: string, options: ApiClientErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = "ApiClientError";
    this.code = code;

    if (options.status !== undefined) {
      this.status = options.status;
    }
  }
}
