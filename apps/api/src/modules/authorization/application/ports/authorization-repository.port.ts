import type { RequestContext } from "@booking-os/contracts";

export type AuthorizationRepositoryScope =
  | { readonly type: "platform" }
  | { readonly type: "tenant"; readonly tenantId: string };

export type AuthorizationExecutionContext = Pick<
  RequestContext,
  "requestId" | "traceId" | "source"
> & {
  readonly actorId: string;
};

interface BaseCurrentScopeAuthority {
  readonly userAuthorizationVersion: number;
  readonly roleKeys: readonly string[];
  readonly permissionKeys: readonly string[];
}

export interface PlatformCurrentScopeAuthority extends BaseCurrentScopeAuthority {
  readonly scope: { readonly type: "platform" };
}

export interface TenantCurrentScopeAuthority extends BaseCurrentScopeAuthority {
  readonly scope: {
    readonly type: "tenant";
    readonly tenantId: string;
    readonly tenantSlug: string;
  };
  readonly membershipId: string;
  readonly membershipStatus: "invited" | "active" | "suspended" | "revoked";
  readonly membershipAuthorizationVersion: number;
}

export type CurrentScopeAuthority = PlatformCurrentScopeAuthority | TenantCurrentScopeAuthority;

export interface LoadCurrentScopeAuthorityInput {
  readonly userId: string;
  readonly scope: AuthorizationRepositoryScope;
  readonly execution: AuthorizationExecutionContext;
}

export interface AuthorizationRepositoryPort {
  loadCurrentScope(input: LoadCurrentScopeAuthorityInput): Promise<CurrentScopeAuthority | null>;
}
