import "reflect-metadata";

import assert from "node:assert/strict";
import test from "node:test";

import { PERMISSION_KEYS, SYSTEM_ROLES } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import {
  TenantCustomRoleNotFoundError,
  TenantCustomRoleVersionConflictError,
  TenantRbacPermissionGrantNotAllowedError,
} from "../../domain/tenant-rbac/tenant-rbac.errors.js";
import { REQUIRES_PERMISSION_METADATA } from "./requires-permission.decorator.js";
import { TenantRbacController } from "./tenant-rbac.controller.js";

const TENANT_ID = "30000000-0000-4000-8000-000000000001";
const ACTOR_ID = "10000000-0000-4000-8000-000000000001";
const ROLE_ID = "50000000-0000-4000-8000-000000000001";
const MEMBERSHIP_ID = "40000000-0000-4000-8000-000000000002";

const AUTHENTICATED: AuthenticatedRequestContext = {
  requestId: "request-rbac-http",
  traceId: "trace-rbac-http",
  source: "internal",
  actorId: ACTOR_ID,
  sessionId: "60000000-0000-4000-8000-000000000001",
  authScope: { type: "tenant", tenantId: TENANT_ID },
  sessionState: "active",
  authorizationVersion: 1,
};

const AUTHORIZATION: AuthorizationContext = {
  userId: ACTOR_ID,
  sessionId: AUTHENTICATED.sessionId,
  scope: { type: "tenant", tenantId: TENANT_ID, tenantSlug: "acme" },
  membershipId: "40000000-0000-4000-8000-000000000001",
  membershipStatus: "active",
  roleKeys: [SYSTEM_ROLES.tenantOwner],
  permissionKeys: Object.values(PERMISSION_KEYS).filter((key) => key.startsWith("tenant.")),
  userAuthorizationVersion: 1,
  membershipAuthorizationVersion: 1,
};

const ROLE = {
  id: ROLE_ID,
  tenantId: TENANT_ID,
  name: "Dispatcher",
  normalizedName: "dispatcher",
  description: "Dispatch operations",
  version: 3,
  archivedAt: null,
  permissionKeys: [PERMISSION_KEYS.tenantMembershipRead],
} as const;

function makeExecutor(name: string, calls: Array<readonly [string, unknown]>, result: unknown) {
  return {
    async execute(input: unknown) {
      calls.push([name, input]);
      return result;
    },
  };
}

function controllerWith(options?: {
  readonly updateError?: Error;
  readonly getError?: Error;
  readonly createError?: Error;
}) {
  const calls: Array<readonly [string, unknown]> = [];
  const requestContext = { requireAuthenticated: () => AUTHENTICATED };
  const controller = new TenantRbacController(
    requestContext as never,
    makeExecutor("permissions", calls, [
      {
        key: PERMISSION_KEYS.tenantMembershipRead,
        scopeLevel: "tenant",
        delegable: true,
        description: "Read tenant memberships.",
      },
    ]) as never,
    makeExecutor("roles", calls, [ROLE]) as never,
    {
      async execute(input: unknown) {
        calls.push(["create", input]);
        if (options?.createError) throw options.createError;
        return ROLE;
      },
    } as never,
    {
      async execute(input: unknown) {
        calls.push(["get", input]);
        if (options?.getError) throw options.getError;
        return ROLE;
      },
    } as never,
    {
      async execute(input: unknown) {
        calls.push(["update", input]);
        if (options?.updateError) throw options.updateError;
        return { ...ROLE, version: 4 };
      },
    } as never,
    makeExecutor("replacePermissions", calls, { ...ROLE, version: 4 }) as never,
    makeExecutor("archive", calls, { ...ROLE, version: 4, archivedAt: new Date() }) as never,
    makeExecutor("membershipRoles", calls, [ROLE]) as never,
    makeExecutor("grant", calls, {
      id: "70000000-0000-4000-8000-000000000001",
      tenantId: TENANT_ID,
      membershipId: MEMBERSHIP_ID,
      roleId: ROLE_ID,
      createdAt: new Date(),
      revokedAt: null,
    }) as never,
    makeExecutor("revoke", calls, true) as never,
  );
  return { calls, controller };
}

function withoutNow(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const { now, ...rest } = value as Record<string, unknown>;
  assert.ok(now instanceof Date);
  return rest;
}

test("routes delegate guard-built authority without accepting tenantId from transport", async () => {
  const { calls, controller } = controllerWith();

  await controller.listPermissions(AUTHORIZATION);
  await controller.listRoles(AUTHORIZATION);
  await controller.createRole(
    {
      name: " Dispatcher ",
      description: "Dispatch operations",
      permissionKeys: [PERMISSION_KEYS.tenantMembershipRead],
    },
    AUTHORIZATION,
  );
  await controller.getRole(ROLE_ID, AUTHORIZATION);
  await controller.updateRole(
    ROLE_ID,
    { name: "Dispatcher", description: null, expectedVersion: 3 },
    AUTHORIZATION,
  );
  await controller.replaceRolePermissions(
    ROLE_ID,
    { permissionKeys: [PERMISSION_KEYS.tenantMembershipRead], expectedVersion: 3 },
    AUTHORIZATION,
  );
  await controller.archiveRole(ROLE_ID, { expectedVersion: 3 }, AUTHORIZATION);
  await controller.listMembershipRoles(MEMBERSHIP_ID, AUTHORIZATION);
  await controller.grantMembershipRole(MEMBERSHIP_ID, ROLE_ID, AUTHORIZATION);
  await controller.revokeMembershipRole(MEMBERSHIP_ID, ROLE_ID, AUTHORIZATION);

  assert.deepEqual(calls.slice(0, 2), [
    ["permissions", { authorization: AUTHORIZATION }],
    ["roles", { authorization: AUTHORIZATION }],
  ]);
  assert.deepEqual(withoutNow(calls[2]?.[1]), {
    authorization: AUTHORIZATION,
    name: "Dispatcher",
    description: "Dispatch operations",
    permissionKeys: [PERMISSION_KEYS.tenantMembershipRead],
    requestId: AUTHENTICATED.requestId,
  });
  assert.deepEqual(calls[3], ["get", { authorization: AUTHORIZATION, roleId: ROLE_ID }]);
  assert.deepEqual(withoutNow(calls[4]?.[1]), {
    authorization: AUTHORIZATION,
    roleId: ROLE_ID,
    name: "Dispatcher",
    description: null,
    expectedVersion: 3,
    requestId: AUTHENTICATED.requestId,
  });
  assert.deepEqual(withoutNow(calls[5]?.[1]), {
    authorization: AUTHORIZATION,
    roleId: ROLE_ID,
    permissionKeys: [PERMISSION_KEYS.tenantMembershipRead],
    expectedVersion: 3,
    requestId: AUTHENTICATED.requestId,
  });
  assert.deepEqual(withoutNow(calls[6]?.[1]), {
    authorization: AUTHORIZATION,
    roleId: ROLE_ID,
    expectedVersion: 3,
    requestId: AUTHENTICATED.requestId,
  });
  assert.deepEqual(calls[7], [
    "membershipRoles",
    { authorization: AUTHORIZATION, membershipId: MEMBERSHIP_ID },
  ]);
  assert.deepEqual(withoutNow(calls[8]?.[1]), {
    authorization: AUTHORIZATION,
    membershipId: MEMBERSHIP_ID,
    roleId: ROLE_ID,
    requestId: AUTHENTICATED.requestId,
  });
  assert.deepEqual(withoutNow(calls[9]?.[1]), {
    authorization: AUTHORIZATION,
    membershipId: MEMBERSHIP_ID,
    roleId: ROLE_ID,
    requestId: AUTHENTICATED.requestId,
  });

  for (const [, input] of calls) {
    assert.equal(Object.hasOwn(input as object, "tenantId"), false);
  }
});

test("permission replacement route admits grant or revoke authority before diff-level checks", () => {
  assert.deepEqual(
    Reflect.getMetadata(
      REQUIRES_PERMISSION_METADATA,
      TenantRbacController.prototype.replaceRolePermissions,
    ),
    [
      PERMISSION_KEYS.tenantRbacRolePermissionGrant,
      PERMISSION_KEYS.tenantRbacRolePermissionRevoke,
    ],
  );
});

test("create role rejects tenantId supplied by the transport", async () => {
  const { calls, controller } = controllerWith();

  await assert.rejects(
    () =>
      controller.createRole(
        {
          tenantId: TENANT_ID,
          name: "Dispatcher",
          description: null,
          permissionKeys: [],
        } as never,
        AUTHORIZATION,
      ),
    (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal((error.getResponse() as { code?: string }).code, "INVALID_REQUEST_BODY");
      return true;
    },
  );

  assert.equal(
    calls.some(([name]) => name === "create"),
    false,
  );
});

test("maps RBAC domain errors to stable safe HTTP responses", async () => {
  const versionConflict = controllerWith({
    updateError: new TenantCustomRoleVersionConflictError(),
  }).controller;
  await assert.rejects(
    () =>
      versionConflict.updateRole(
        ROLE_ID,
        { name: "Dispatcher", description: null, expectedVersion: 2 },
        AUTHORIZATION,
      ),
    (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.equal(
        (error.getResponse() as { code?: string }).code,
        "TENANT_CUSTOM_ROLE_VERSION_CONFLICT",
      );
      return true;
    },
  );

  const notFound = controllerWith({ getError: new TenantCustomRoleNotFoundError() }).controller;
  await assert.rejects(
    () => notFound.getRole(ROLE_ID, AUTHORIZATION),
    (error: unknown) => {
      assert.ok(error instanceof NotFoundException);
      assert.equal((error.getResponse() as { code?: string }).code, "TENANT_CUSTOM_ROLE_NOT_FOUND");
      return true;
    },
  );

  const denied = controllerWith({
    createError: new TenantRbacPermissionGrantNotAllowedError(),
  }).controller;
  await assert.rejects(
    () =>
      denied.createRole(
        { name: "Dispatcher", description: null, permissionKeys: [] },
        AUTHORIZATION,
      ),
    (error: unknown) => {
      assert.ok(error instanceof ForbiddenException);
      assert.equal(
        (error.getResponse() as { code?: string }).code,
        "TENANT_RBAC_PERMISSION_GRANT_NOT_ALLOWED",
      );
      assert.doesNotMatch(JSON.stringify(error.getResponse()), /prisma|sql|query|constraint/iu);
      return true;
    },
  );
});
