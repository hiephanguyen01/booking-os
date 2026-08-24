import type { RequestContext } from "@booking-os/contracts";

export type { RequestContext } from "@booking-os/contracts";

export type AuthenticatedScope =
  | { readonly type: "platform" }
  | { readonly type: "tenant"; readonly tenantId: string }
  | { readonly type: "partner"; readonly tenantId: string; readonly partnerId: string };

export interface AuthenticatedRequestContext extends RequestContext {
  readonly actorId: string;
  readonly sessionId: string;
  readonly authScope: AuthenticatedScope;
  readonly sessionState: "active" | "invitation_pending";
  readonly authorizationVersion: number;
  readonly membershipAuthorizationVersion?: number;
  readonly partnerAuthorizationVersion?: number;
  readonly partnerMembershipAuthorizationVersion?: number;
}

export type AuthorizationReadyRequestContext =
  | (AuthenticatedRequestContext & {
      readonly authScope: { readonly type: "platform" };
      readonly sessionState: "active";
      readonly membershipAuthorizationVersion?: never;
      readonly partnerAuthorizationVersion?: never;
      readonly partnerMembershipAuthorizationVersion?: never;
    })
  | (AuthenticatedRequestContext & {
      readonly authScope: { readonly type: "tenant"; readonly tenantId: string };
      readonly sessionState: "active";
      readonly membershipAuthorizationVersion: number;
      readonly partnerAuthorizationVersion?: never;
      readonly partnerMembershipAuthorizationVersion?: never;
    })
  | (AuthenticatedRequestContext & {
      readonly authScope: {
        readonly type: "partner";
        readonly tenantId: string;
        readonly partnerId: string;
      };
      readonly sessionState: "active";
      readonly membershipAuthorizationVersion: number;
      readonly partnerAuthorizationVersion: number;
      readonly partnerMembershipAuthorizationVersion: number;
    });

function positiveInteger(value: number | undefined): boolean {
  return Number.isInteger(value) && (value ?? 0) > 0;
}

export function isAuthenticatedRequestContext(
  context: RequestContext,
): context is AuthenticatedRequestContext {
  const candidate = context as Partial<AuthenticatedRequestContext>;
  const validScope =
    candidate.authScope?.type === "platform" ||
    (candidate.authScope?.type === "tenant" &&
      typeof candidate.authScope.tenantId === "string" &&
      candidate.authScope.tenantId.length > 0) ||
    (candidate.authScope?.type === "partner" &&
      typeof candidate.authScope.tenantId === "string" &&
      candidate.authScope.tenantId.length > 0 &&
      typeof candidate.authScope.partnerId === "string" &&
      candidate.authScope.partnerId.length > 0);
  return (
    typeof candidate.actorId === "string" &&
    candidate.actorId.length > 0 &&
    typeof candidate.sessionId === "string" &&
    candidate.sessionId.length > 0 &&
    (candidate.sessionState === "active" || candidate.sessionState === "invitation_pending") &&
    positiveInteger(candidate.authorizationVersion) &&
    validScope
  );
}

export function isAuthorizationReadyRequestContext(
  context: AuthenticatedRequestContext,
): context is AuthorizationReadyRequestContext {
  if (context.sessionState !== "active") return false;
  if (context.authScope.type === "platform") return true;
  if (!positiveInteger(context.membershipAuthorizationVersion)) return false;
  if (context.authScope.type === "tenant") return true;
  return (
    positiveInteger(context.partnerAuthorizationVersion) &&
    positiveInteger(context.partnerMembershipAuthorizationVersion)
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
