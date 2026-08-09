import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import {
  PERMISSION_GUARD_EXEMPT_METADATA,
  REQUIRES_PERMISSION_METADATA,
} from "../src/modules/authorization/authorization.http.js";
import { PlatformTenantsController } from "../src/modules/memberships/infrastructure/http/platform-tenants.controller.js";
import { TenantInvitationsController } from "../src/modules/memberships/infrastructure/http/tenant-invitations.controller.js";
import { TenantMembershipsController } from "../src/modules/memberships/infrastructure/http/tenant-memberships.controller.js";

function declaredPermission(controller: object, method: string): string | undefined {
  const handler = (controller as Record<string, unknown>)[method];
  return typeof handler === "function"
    ? (Reflect.getMetadata(REQUIRES_PERMISSION_METADATA, handler) as string | undefined)
    : undefined;
}

function declaredExemption(controller: object, method: string): string | undefined {
  const handler = (controller as Record<string, unknown>)[method];
  return typeof handler === "function"
    ? (Reflect.getMetadata(PERMISSION_GUARD_EXEMPT_METADATA, handler) as string | undefined)
    : undefined;
}

test("every Sprint 1B platform and active-membership route declares one permission", () => {
  const matrix = [
    [PlatformTenantsController.prototype, "create", "platform.tenants.provision"],
    [PlatformTenantsController.prototype, "get", "platform.tenants.provision"],
    [PlatformTenantsController.prototype, "resendOwnerInvitation", "platform.tenants.provision"],
    [TenantInvitationsController.prototype, "create", "tenant.membership.admin.invite"],
    [TenantInvitationsController.prototype, "resend", "tenant.membership.admin.invite"],
    [TenantMembershipsController.prototype, "list", "tenant.membership.read"],
    [TenantMembershipsController.prototype, "suspend", "tenant.membership.admin.suspend"],
    [TenantMembershipsController.prototype, "revoke", "tenant.membership.admin.revoke"],
    [TenantMembershipsController.prototype, "promoteOwner", "tenant.membership.owner.promote"],
    [TenantMembershipsController.prototype, "demoteOwner", "tenant.membership.owner.demote"],
  ] as const;

  for (const [controller, method, permission] of matrix) {
    assert.equal(declaredPermission(controller, method), permission, method);
  }
});

test("invitation-pending routes declare an explicit permission-guard exemption", () => {
  assert.equal(declaredPermission(TenantInvitationsController.prototype, "current"), undefined);
  assert.equal(declaredPermission(TenantInvitationsController.prototype, "accept"), undefined);
  assert.equal(
    declaredExemption(TenantInvitationsController.prototype, "current"),
    "invitation_pending",
  );
  assert.equal(
    declaredExemption(TenantInvitationsController.prototype, "accept"),
    "invitation_pending",
  );
});
