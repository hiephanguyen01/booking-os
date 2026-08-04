import type { HealthResponse } from "@booking-os/contracts/health";

import { ApiClientError } from "./errors.js";
import {
  createGeneratedClient,
  type GeneratedRequest,
  type GeneratedTransport,
} from "./generated/client.js";
import { healthResponseSchema } from "./health-schema.js";
import { createFetchTransport, type FetchTransportOptions } from "./transport.js";

const SUPPORTED_API_PREFIX = "/api";

export type ApiClientOptions = FetchTransportOptions;

export interface ApiClient {
  readonly health: {
    readonly get: () => Promise<HealthResponse>;
  };
}

function relativeToApiRoot(request: GeneratedRequest): GeneratedRequest {
  const path = request.path.startsWith(`${SUPPORTED_API_PREFIX}/`)
    ? request.path.slice(SUPPORTED_API_PREFIX.length)
    : request.path;
  return { ...request, path };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const fetchTransport = createFetchTransport(options);
  const generatedTransport: GeneratedTransport = <TResponse>(request, requestOptions) =>
    fetchTransport<TResponse>(relativeToApiRoot(request), requestOptions);
  const generatedClient = createGeneratedClient(generatedTransport);

  async function getHealth(): Promise<HealthResponse> {
    const payload: unknown = await generatedClient.getHealth();
    const result = healthResponseSchema.safeParse(payload);
    if (!result.success) {
      throw new ApiClientError("invalid_response", "Health response does not match the contract", {
        cause: result.error,
      });
    }
    return result.data;
  }

  return {
    health: {
      get: getHealth,
    },
  };
}
