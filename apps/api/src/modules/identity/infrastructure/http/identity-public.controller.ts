import type {
  CompleteActivationCommand,
  CompleteActivationResult,
} from "../../application/use-cases/complete-activation.js";
import type {
  CompletePasswordResetCommand,
  CompletePasswordResetResult,
} from "../../application/use-cases/complete-password-reset.js";
import type { RequestPasswordResetCommand } from "../../application/use-cases/request-password-reset.js";
import type { IdentityScopeType } from "../../domain/user.js";
import type { IssuedPreAuthCsrf, PreAuthCsrfPurpose } from "./pre-auth-csrf.js";

export interface IdentityPublicHttpRequest {
  readonly hostname: string;
  readonly expectedOrigin: string;
  readonly origin: string | null;
  readonly csrfCookie: string | null;
  readonly csrfToken: string | null;
  readonly requestId: string | null;
}

export interface IdentityPublicHttpResponse {
  status(code: number): this;
  setHeader(name: string, value: string): void;
  cookie(name: string, value: string, options: unknown): void;
}

export interface IdentityPublicCsrfPort {
  issue(input: {
    readonly hostname: string;
    readonly purpose: PreAuthCsrfPurpose;
  }): IssuedPreAuthCsrf;
  assertRequest(request: IdentityPublicHttpRequest, purpose: PreAuthCsrfPurpose): void;
}

export interface CompleteActivationExecutor {
  execute(command: CompleteActivationCommand): Promise<CompleteActivationResult>;
}

export interface RequestPasswordResetExecutor {
  execute(command: RequestPasswordResetCommand): Promise<void>;
}

export interface CompletePasswordResetExecutor {
  execute(command: CompletePasswordResetCommand): Promise<CompletePasswordResetResult>;
}

export interface IdentityPublicControllerDependencies {
  csrf: IdentityPublicCsrfPort;
  completeActivation: CompleteActivationExecutor;
  requestPasswordReset: RequestPasswordResetExecutor;
  completePasswordReset: CompletePasswordResetExecutor;
}

export interface IdentityScopeBody {
  readonly scopeType: IdentityScopeType;
  readonly tenantId?: string;
}

export interface CompleteIdentityPasswordBody extends IdentityScopeBody {
  readonly token: string;
  readonly newPassword: string;
}

export interface RequestIdentityPasswordResetBody extends IdentityScopeBody {
  readonly email: string;
}

function applySensitiveResponseHeaders(response: IdentityPublicHttpResponse): void {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
}

function commandScope(
  body: IdentityScopeBody,
):
  | { readonly scopeType: IdentityScopeType }
  | { readonly scopeType: IdentityScopeType; readonly tenantId: string } {
  return body.tenantId === undefined
    ? { scopeType: body.scopeType }
    : { scopeType: body.scopeType, tenantId: body.tenantId };
}

export class IdentityPublicController {
  constructor(private readonly dependencies: IdentityPublicControllerDependencies) {}

  getCsrf(
    purpose: PreAuthCsrfPurpose,
    request: IdentityPublicHttpRequest,
    response: IdentityPublicHttpResponse,
  ): { readonly csrfToken: string; readonly expiresAt: string } {
    const issued = this.dependencies.csrf.issue({ hostname: request.hostname, purpose });
    applySensitiveResponseHeaders(response);
    response.cookie(issued.cookie.name, issued.cookie.value, issued.cookie.options);

    return Object.freeze({
      csrfToken: issued.token,
      expiresAt: issued.expiresAt.toISOString(),
    });
  }

  async requestPasswordReset(
    body: RequestIdentityPasswordResetBody,
    request: IdentityPublicHttpRequest,
    response: IdentityPublicHttpResponse,
  ): Promise<{ readonly accepted: true }> {
    this.dependencies.csrf.assertRequest(request, "password_forgot");
    applySensitiveResponseHeaders(response);
    await this.dependencies.requestPasswordReset.execute({
      email: body.email,
      hostname: request.hostname,
      ...commandScope(body),
      requestId: request.requestId,
    });
    response.status(202);
    return Object.freeze({ accepted: true });
  }

  async completeActivation(
    body: CompleteIdentityPasswordBody,
    request: IdentityPublicHttpRequest,
    response: IdentityPublicHttpResponse,
  ): Promise<{ readonly completed: true }> {
    this.dependencies.csrf.assertRequest(request, "activation");
    applySensitiveResponseHeaders(response);
    await this.dependencies.completeActivation.execute({
      token: body.token,
      newPassword: body.newPassword,
      hostname: request.hostname,
      ...commandScope(body),
      requestId: request.requestId,
    });
    return Object.freeze({ completed: true });
  }

  async completePasswordReset(
    body: CompleteIdentityPasswordBody,
    request: IdentityPublicHttpRequest,
    response: IdentityPublicHttpResponse,
  ): Promise<{ readonly completed: true }> {
    this.dependencies.csrf.assertRequest(request, "password_reset");
    applySensitiveResponseHeaders(response);
    await this.dependencies.completePasswordReset.execute({
      token: body.token,
      newPassword: body.newPassword,
      hostname: request.hostname,
      ...commandScope(body),
      requestId: request.requestId,
    });
    return Object.freeze({ completed: true });
  }
}
