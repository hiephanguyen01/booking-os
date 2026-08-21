import type { PermissionKey } from "@booking-os/auth";
import { SetMetadata } from "@nestjs/common";

export const REQUIRES_PERMISSION_METADATA = Symbol("REQUIRES_PERMISSION_METADATA");
export const PERMISSION_GUARD_EXEMPT_METADATA = Symbol("PERMISSION_GUARD_EXEMPT_METADATA");

export type PermissionGuardExemption = "invitation_pending";
export type RequiredPermissionMetadata =
  | PermissionKey
  | readonly [PermissionKey, ...PermissionKey[]];

export function RequiresPermission(permission: PermissionKey) {
  return SetMetadata(REQUIRES_PERMISSION_METADATA, permission);
}

export function RequiresAnyPermission(permission: PermissionKey, ...permissions: PermissionKey[]) {
  return SetMetadata(
    REQUIRES_PERMISSION_METADATA,
    Object.freeze([permission, ...permissions] as [PermissionKey, ...PermissionKey[]]),
  );
}

export function PermissionGuardExempt(reason: PermissionGuardExemption) {
  return SetMetadata(PERMISSION_GUARD_EXEMPT_METADATA, reason);
}
