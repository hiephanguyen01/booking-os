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

export interface LoginSessionParameters {
  readonly body: operations["loginSession"]["requestBody"]["content"]["application/json"];
}

export interface RequestPasswordResetParameters {
  readonly body: operations["requestPasswordReset"]["requestBody"]["content"]["application/json"];
}

export interface CompletePasswordResetParameters {
  readonly body: operations["completePasswordReset"]["requestBody"]["content"]["application/json"];
}

export interface RevokeSessionParameters {
  readonly path: operations["revokeSession"]["parameters"]["path"];
}

export interface GeneratedClient {
  readonly completeAccountActivation: (parameters: CompleteAccountActivationParameters, options?: GeneratedRequestOptions) => Promise<operations["completeAccountActivation"]["responses"][200]["content"]["application/json"]>;
  readonly getPreAuthCsrf: (parameters: GetPreAuthCsrfParameters, options?: GeneratedRequestOptions) => Promise<operations["getPreAuthCsrf"]["responses"][200]["content"]["application/json"]>;
  readonly loginSession: (parameters: LoginSessionParameters, options?: GeneratedRequestOptions) => Promise<operations["loginSession"]["responses"][200]["content"]["application/json"]>;
  readonly logoutSession: (options?: GeneratedRequestOptions) => Promise<operations["logoutSession"]["responses"][200]["content"]["application/json"]>;
  readonly getCurrentSession: (options?: GeneratedRequestOptions) => Promise<operations["getCurrentSession"]["responses"][200]["content"]["application/json"]>;
  readonly requestPasswordReset: (parameters: RequestPasswordResetParameters, options?: GeneratedRequestOptions) => Promise<operations["requestPasswordReset"]["responses"][202]["content"]["application/json"]>;
  readonly completePasswordReset: (parameters: CompletePasswordResetParameters, options?: GeneratedRequestOptions) => Promise<operations["completePasswordReset"]["responses"][200]["content"]["application/json"]>;
  readonly getSessionCsrf: (options?: GeneratedRequestOptions) => Promise<operations["getSessionCsrf"]["responses"][200]["content"]["application/json"]>;
  readonly refreshSession: (options?: GeneratedRequestOptions) => Promise<operations["refreshSession"]["responses"][200]["content"]["application/json"]>;
  readonly listSessions: (options?: GeneratedRequestOptions) => Promise<operations["listSessions"]["responses"][200]["content"]["application/json"]>;
  readonly revokeOtherSessions: (options?: GeneratedRequestOptions) => Promise<operations["revokeOtherSessions"]["responses"][200]["content"]["application/json"]>;
  readonly revokeSession: (parameters: RevokeSessionParameters, options?: GeneratedRequestOptions) => Promise<operations["revokeSession"]["responses"][200]["content"]["application/json"]>;
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
    async loginSession(parameters, options) {
      return transport<operations["loginSession"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/auth/login",
      body: parameters.body,
      }, options);
    },
    async logoutSession(options) {
      return transport<operations["logoutSession"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/auth/logout",
      }, options);
    },
    async getCurrentSession(options) {
      return transport<operations["getCurrentSession"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/auth/me",
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
    async getSessionCsrf(options) {
      return transport<operations["getSessionCsrf"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/auth/session/csrf",
      }, options);
    },
    async refreshSession(options) {
      return transport<operations["refreshSession"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/auth/session/refresh",
      }, options);
    },
    async listSessions(options) {
      return transport<operations["listSessions"]["responses"][200]["content"]["application/json"]>({
      method: "GET",
      path: "/api/auth/sessions",
      }, options);
    },
    async revokeOtherSessions(options) {
      return transport<operations["revokeOtherSessions"]["responses"][200]["content"]["application/json"]>({
      method: "POST",
      path: "/api/auth/sessions/revoke-others",
      }, options);
    },
    async revokeSession(parameters, options) {
      return transport<operations["revokeSession"]["responses"][200]["content"]["application/json"]>({
      method: "DELETE",
      path: `/api/auth/sessions/${encodeURIComponent(String(parameters.path.sessionId))}`,
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
