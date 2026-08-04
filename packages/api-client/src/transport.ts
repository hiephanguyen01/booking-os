import { ApiClientError } from "./errors.js";
import type {
  GeneratedRequest,
  GeneratedRequestOptions,
  GeneratedTransport,
} from "./generated/client.js";

const DEFAULT_TIMEOUT_MS = 2_000;

export interface FetchTransportOptions {
  readonly baseUrl: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
  readonly defaultHeaders?: Readonly<Record<string, string>>;
  readonly credentials?: RequestCredentials;
  readonly requestId?: string | (() => string | undefined);
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
    throw new ApiClientError("invalid_config", "API base URL must be a valid HTTP(S) URL", {
      cause,
    });
  }
}

function parseTimeout(value: number | undefined): number {
  const timeoutMs = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ApiClientError("invalid_config", "API timeout must be a positive finite number");
  }
  return timeoutMs;
}

function appendQueryValue(parameters: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      appendQueryValue(parameters, key, item);
    }
    return;
  }
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    parameters.append(key, String(value));
    return;
  }
  throw new ApiClientError("invalid_config", `Unsupported query value for ${key}`);
}

function buildUrl(
  baseUrl: URL,
  path: string,
  query: Readonly<Record<string, unknown>> | undefined,
): URL {
  const url = new URL(path.replace(/^\/+/, ""), baseUrl);
  if (query !== undefined) {
    const parameters = new URLSearchParams();
    for (const key of Object.keys(query).sort()) {
      appendQueryValue(parameters, key, query[key]);
    }
    url.search = parameters.toString();
  }
  return url;
}

function resolveRequestId(value: FetchTransportOptions["requestId"]): string | undefined {
  return typeof value === "function" ? value() : value;
}

function buildHeaders(
  options: FetchTransportOptions,
  request: GeneratedRequest,
): Headers {
  const headers = new Headers({ accept: "application/json" });
  for (const [name, value] of Object.entries(options.defaultHeaders ?? {})) {
    headers.set(name, value);
  }
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    headers.set(name, value);
  }

  const requestId = resolveRequestId(options.requestId);
  if (requestId !== undefined && !headers.has("x-request-id")) {
    headers.set("x-request-id", requestId);
  }
  if (request.body !== undefined) {
    headers.set("content-type", "application/json");
  }
  return headers;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  );
}

function forwardAbort(parent: AbortSignal | undefined, child: AbortController): () => void {
  if (parent === undefined) {
    return () => undefined;
  }
  if (parent.aborted) {
    child.abort(parent.reason);
    return () => undefined;
  }
  const abort = () => child.abort(parent.reason);
  parent.addEventListener("abort", abort, { once: true });
  return () => parent.removeEventListener("abort", abort);
}

async function parseResponse<TResponse>(response: Response): Promise<TResponse> {
  if (!response.ok) {
    throw new ApiClientError("http", `API request failed with HTTP ${response.status}`, {
      status: response.status,
    });
  }

  const body = await response.text();
  if (body === "") {
    return undefined as TResponse;
  }
  try {
    return JSON.parse(body) as TResponse;
  } catch (cause) {
    throw new ApiClientError("invalid_response", "API response is not valid JSON", { cause });
  }
}

export function createFetchTransport(options: FetchTransportOptions): GeneratedTransport {
  const baseUrl = parseBaseUrl(options.baseUrl);
  const timeoutMs = parseTimeout(options.timeoutMs);
  const fetchImplementation = options.fetchImplementation ?? fetch;

  return async <TResponse>(
    request: GeneratedRequest,
    requestOptions?: GeneratedRequestOptions,
  ): Promise<TResponse> => {
    const url = buildUrl(baseUrl, request.path, request.query);
    const controller = new AbortController();
    const removeParentAbort = forwardAbort(requestOptions?.signal, controller);
    let timeoutTriggered = false;
    const timeout = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetchImplementation(url, {
        method: request.method,
        headers: buildHeaders(options, request),
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        credentials: options.credentials,
        signal: controller.signal,
      });
      return await parseResponse<TResponse>(response);
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      if (timeoutTriggered && isAbortError(error)) {
        throw new ApiClientError("timeout", `API request timed out after ${timeoutMs}ms`, {
          cause: error,
        });
      }
      throw new ApiClientError("network", "API request failed before receiving a response", {
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
      removeParentAbort();
    }
  };
}
