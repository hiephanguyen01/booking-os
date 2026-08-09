import type { ActiveTenantAuthorizationContext } from "./auth/authorization-context.js";

export type ExecutionSource = "storefront" | "console" | "worker" | "internal";

export interface RequestContext {
  readonly requestId: string;
  readonly traceId: string;
  readonly source: ExecutionSource;
  readonly actorId?: string;
  readonly tenantId?: string;
}

export interface TenantExecutionContext extends RequestContext {
  readonly tenantId: string;
}

export interface AuthorizedTenantExecutionContext extends TenantExecutionContext {
  readonly actorId: string;
  readonly sessionId: string;
  readonly authorization: ActiveTenantAuthorizationContext;
}
