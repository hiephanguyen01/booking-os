// AUTO-GENERATED. DO NOT EDIT. Run pnpm api:generate.
import type { operations } from "./schema.js";

export interface GeneratedRequest {
  readonly method: string;
  readonly path: string;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface GeneratedRequestOptions {
  readonly signal?: AbortSignal;
}

export type GeneratedTransport = <TResponse>(
  request: GeneratedRequest,
  options?: GeneratedRequestOptions,
) => Promise<TResponse>;

export interface GeneratedClient {
  readonly getHealth: (options?: GeneratedRequestOptions) => Promise<operations["getHealth"]["responses"][200]["content"]["application/json"]>;
  readonly getReadiness: (options?: GeneratedRequestOptions) => Promise<operations["getReadiness"]["responses"][200]["content"]["application/json"]>;
}

export function createGeneratedClient(transport: GeneratedTransport): GeneratedClient {
  return {
    async getHealth(options) {
      return transport<operations["getHealth"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/health",
      }, options);
    },
    async getReadiness(options) {
      return transport<operations["getReadiness"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/ready",
      }, options);
    },
  };
}
