import type {
  RequestContext,
  TenantExecutionContext,
} from "@booking-os/contracts";

import { isTenantId } from "../domain/tenant-id.js";
import {
  InvalidTenantContextError,
  TenantContextUnavailableError,
} from "./tenant-context.errors.js";

export function requireTenantExecutionContext(
  context: RequestContext,
): TenantExecutionContext {
  if (!context.tenantId) {
    throw new TenantContextUnavailableError();
  }
  if (!isTenantId(context.tenantId)) {
    throw new InvalidTenantContextError();
  }
  return context as TenantExecutionContext;
}
