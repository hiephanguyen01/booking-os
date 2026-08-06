import type { RequestContext } from "@booking-os/contracts";

export type { RequestContext } from "@booking-os/contracts";

export type AuthenticatedScope =
  | { readonly type: "platform" }
  | { readonly type: "tenant"; readonly tenantId: string };

export interface AuthenticatedRequestContext extends RequestContext {
  readonly actorId: string;
  readonly sessionId: string;
  readonly authScope: AuthenticatedScope;
  readonly sessionState: "active" | "invitation_pending";
}

export function isAuthenticatedRequestContext(
  context: RequestContext,
): context is AuthenticatedRequestContext {
  const candidate = context as Partial<AuthenticatedRequestContext>;
  return (
    typeof candidate.actorId === "string" &&
    candidate.actorId.length > 0 &&
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    (candidate.sessionState === "active" || candidate.sessionState === "invitation_pending") &&
    (candidate.authScope?.type === "platform" ||
      (candidate.authScope?.type === "tenant" &&
        typeof candidate.authScope.tenantId === "string" &&
        candidate.authScope.tenantId.length > 0))
  );
}

export interface RequestHeaders {
  readonly [name: string]: string | string[] | undefined;
}

export interface RequestWithHeaders {
  readonly headers: RequestHeaders;
  readonly requestId?: string;
}

export interface ResponseWithHeaders {
  setHeader(name: string, value: string): void;
}
