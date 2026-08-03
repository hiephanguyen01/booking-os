import type { HealthResponse } from "@booking-os/contracts/health";

import { ApiClientError } from "./errors.js";
import { healthResponseSchema } from "./health-schema.js";

const DEFAULT_TIMEOUT_MS = 2_000;

export interface ApiClientOptions {
  readonly baseUrl: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
}

export interface ApiClient {
  readonly health: {
    readonly get: () => Promise<HealthResponse>;
  };
}

function parseBaseUrl(value: string): URL {
  try {
    const url = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }

    if (!url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }

    return url;
  } catch (cause) {
    throw new ApiClientError(
      "invalid_config",
      "API base URL must be a valid HTTP(S) URL",
      { cause },
    );
  }
}

function parseTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ApiClientError(
      "invalid_config",
      "API timeout must be a positive finite number",
    );
  }

  return timeoutMs;
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = parseBaseUrl(options.baseUrl);
  const timeoutMs = parseTimeout(options.timeoutMs);
  const fetchImplementation = options.fetchImplementation ?? fetch;
  const healthUrl = new URL("health", baseUrl);

  async function getHealth(): Promise<HealthResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImplementation(healthUrl, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ApiClientError(
          "http",
          `Health request failed with HTTP ${response.status}`,
          { status: response.status },
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (cause) {
        throw new ApiClientError(
          "invalid_response",
          "Health response is not valid JSON",
          { cause },
        );
      }

      const result = healthResponseSchema.safeParse(payload);
      if (!result.success) {
        throw new ApiClientError(
          "invalid_response",
          "Health response does not match the contract",
          { cause: result.error },
        );
      }

      return result.data;
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }

      if (controller.signal.aborted || isAbortError(error)) {
        throw new ApiClientError(
          "timeout",
          `Health request timed out after ${timeoutMs}ms`,
          { cause: error },
        );
      }

      throw new ApiClientError(
        "network",
        "Health request failed before receiving a response",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    health: {
      get: getHealth,
    },
  };
}
