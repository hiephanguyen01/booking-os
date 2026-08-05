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

export interface CompleteAccountActivationParameters {
  readonly body: operations["completeAccountActivation"]["requestBody"]["content"]["application/json"];
}

export interface GetPreAuthCsrfParameters {
  readonly query: operations["getPreAuthCsrf"]["parameters"]["query"];
}

export interface RequestPasswordResetParameters {
  readonly body: operations["requestPasswordReset"]["requestBody"]["content"]["application/json"];
}

export interface CompletePasswordResetParameters {
  readonly body: operations["completePasswordReset"]["requestBody"]["content"]["application/json"];
}

export interface GeneratedClient {
  readonly completeAccountActivation: (parameters: CompleteAccountActivationParameters, options?: GeneratedRequestOptions) => Promise<operations["completeAccountActivation"]["responses"][200]["content"]["application/json"]>;
  readonly getPreAuthCsrf: (parameters: GetPreAuthCsrfParameters, options?: GeneratedRequestOptions) => Promise<operations["getPreAuthCsrf"]["responses"][200]["content"]["application/json"]>;
  readonly requestPasswordReset: (parameters: RequestPasswordResetParameters, options?: GeneratedRequestOptions) => Promise<operations["requestPassswordReset"]["responses"][202]["content"]["application/json"]>;
  readonly completePasswordReset: (parameters: CompletePasswordResetParameters, options?: GeneratedRequestOptions) => Promise<operations["completePasswordReset"]["responses"][200]["content"]["application/json"]>;
  readonly getHealth: (options?: GeneratedRequestOptions) => Promise<operations["getHealth"]["responses"][200]["content"]["application/json"]>;
  readonly getReadiness: (options?: GeneratedRequestOptions) => Promise<operations["getReadiness"]["responses"][200]["content"]["application/json"]>;
}

export function createGeneratedClient(transport: GeneratedTransport): GeneratedClient {
  return {
    async completeAccountActivation(parameters, options) {
      return transport<operations["completeAccountActivation"]["responses"][200]["content"]["application/json"]>({
        method: "POST",
        path: "/api/auth/activation/complete",
        body: parameters.body,
      }, options);
    },
    async getPreAuthCsrf(parameters, options) {
      return transport<operations["getPreAuthCsrf"]["responses"][200]["content"]["application/json"]>({
        method: "GET",
        path: "/api/auth/csrf",
        query: parameters.query,
      }, options);
    },
    async requestPasswordReset(parameters, options) {
      return transport<operations["requestPasswordReset"]["responses"][202]["content"]["application/json"]>({
        method: "POST",
        path: "/api/auth/password/forgot",
        body: parameters.body,
      }, options);
    },
    async completePasswordReset(parameters, options) {
      return transport<operations["completePasswordReset"]["responses"][200]["content"]["application/json"]>({
        method: "POST",
        path: "/api/auth/password/reset",
        body: parameters.body,
      }, options);
    },
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
