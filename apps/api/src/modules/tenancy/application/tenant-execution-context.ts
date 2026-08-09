import type {
  AuthorizedTenantExecutionContext,
  RequestContext,
  TenantExecutionContext,
} from "@booking-os/contracts";

import { isTenantId } from "../domain/tenant-id.js";
import {
  InvalidTenantContextError,
  TenantContextUnavailableError,
} from "./tenant-context.errors.js";

export function requireTenantExecutionContext(context: RequestContext): TenantExecutionContext {
  if (!context.tenantId) {
    throw new TenantContextUnavailableError();
  }
  if (!isTenantId(context.tenantId)) {
    throw new InvalidTenantContextError();
  }
  return context as TenantExecutionContext;
}

export function requireAuthorizedTenantExecutionContext(
  context: RequestContext,
): AuthorizedTenantExecutionContext {
  const tenant = requireTenantExecutionContext(context);
  const candidate = tenant as Partial<AuthorizedTenantExecutionContext>;
  const authorization = candidate.authorization;
  if (
    typeof candidate.actorId !== "string" ||
    typeof candidate.sessionId !== "string" ||
    !authorization ||
    authorization.scope.type !== "tenant" ||
    authorization.scope.tenantId !== tenant.tenantId ||
    authorization.userId !== candidate.actorId ||
    authorization.sessionId !== candidate.sessionId ||
    authorization.membershipStatus !== "active" ||
    typeof authorization.membershipId !== "string" ||
    !Number.isInteger(authorization.userAuthorizationVersion) ||
    !Number.isInteger(authorization.membershipAuthorizationVersion)
  ) {
    throw new InvalidTenantContextError();
  }
  return candidate as AuthorizedTenantExecutionContext;
}
