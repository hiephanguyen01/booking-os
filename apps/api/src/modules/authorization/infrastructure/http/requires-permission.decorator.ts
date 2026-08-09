import type { PermissionKey } from "@booking-os/auth";
import { SetMetadata } from "@nestjs/common";

export const REQUIRES_PERMISSION_METADATA = Symbol("REQUIRES_PERMISSION_METADATA");
export const PERMISSION_GUARD_EXEMPT_METADATA = Symbol("PERMISSION_GUARD_EXEMPT_METADATA");

export type PermissionGuardExemption = "invitation_pending";

export function RequiresPermission(permission: PermissionKey) {
  return SetMetadata(REQUIRES_PERMISSION_METADATA, permission);
}

export function PermissionGuardExempt(reason: PermissionGuardExemption) {
  return SetMetadata(PERMISSION_GUARD_EXEMPT_METADATA, reason);
}
