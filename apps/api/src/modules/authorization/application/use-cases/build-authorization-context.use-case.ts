import {
  AUTHORIZATION_PERMISSION_KEYS,
  AUTHORIZATION_ROLE_KEYS,
  type AuthorizationContext,
  type AuthorizationPermissionKey,
  type AuthorizationRoleKey,
} from "@booking-os/contracts";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import {
  AuthorizationAuthorityInvalidError,
  AuthorizationSessionIneligibleError,
  AuthorizationSubjectInactiveError,
} from "../../domain/authorization.errors.js";
import type {
  AuthorizationRepositoryPort,
  CurrentScopeAuthority,
} from "../ports/authorization-repository.port.js";

const KNOWN_ROLES = new Set<string>(AUTHORIZATION_ROLE_KEYS);
const KNOWN_PERMISSIONS = new Set<string>(AUTHORIZATION_PERMISSION_KEYS);

function positiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function knownValues<Value extends string>(
  values: readonly string[],
  known: ReadonlySet<string>,
): readonly Value[] {
  if (!values.every((value) => known.has(value))) {
    throw new AuthorizationAuthorityInvalidError();
  }
  return Object.freeze([...new Set(values)].sort()) as readonly Value[];
}

function validateCatalog(authority: CurrentScopeAuthority): {
  readonly roleKeys: readonly AuthorizationRoleKey[];
  readonly permissionKeys: readonly AuthorizationPermissionKey[];
} {
  const roleKeys = knownValues<AuthorizationRoleKey>(authority.roleKeys, KNOWN_ROLES);
  const permissionKeys = knownValues<AuthorizationPermissionKey>(
    authority.permissionKeys,
    KNOWN_PERMISSIONS,
  );
  const expectedPrefix = authority.scope.type === "platform" ? "platform." : "tenant.";
  const invalidRole = (role: AuthorizationRoleKey): boolean =>
    authority.scope.type === "platform"
      ? role !== "platform_admin"
      : role !== "tenant_owner" && role !== "tenant_admin";
  if (
    roleKeys.length === 0 ||
    roleKeys.some(invalidRole) ||
    permissionKeys.some((permission) => !permission.startsWith(expectedPrefix))
  ) {
    throw new AuthorizationAuthorityInvalidError();
  }
  return { roleKeys, permissionKeys };
}

export class BuildAuthorizationContextUseCase {
  constructor(private readonly authorization: AuthorizationRepositoryPort) {}

  async execute(authenticated: AuthenticatedRequestContext): Promise<AuthorizationContext> {
    if (authenticated.sessionState !== "active") {
      throw new AuthorizationSessionIneligibleError();
    }

    const authority = await this.authorization.loadCurrentScope({
      userId: authenticated.actorId,
      scope: authenticated.authScope,
      execution: {
        requestId: authenticated.requestId,
        traceId: authenticated.traceId,
        source: authenticated.source,
        actorId: authenticated.actorId,
      },
    });
    if (!authority) {
      throw new AuthorizationSubjectInactiveError();
    }
    if (
      authority.scope.type !== authenticated.authScope.type ||
      !positiveInteger(authority.userAuthorizationVersion)
    ) {
      throw new AuthorizationAuthorityInvalidError();
    }

    const catalog = validateCatalog(authority);
    if (authority.scope.type === "platform") {
      return Object.freeze({
        userId: authenticated.actorId,
        sessionId: authenticated.sessionId,
        scope: Object.freeze({ type: "platform" as const }),
        roleKeys: catalog.roleKeys,
        permissionKeys: catalog.permissionKeys,
        userAuthorizationVersion: authority.userAuthorizationVersion,
      });
    }

    if (
      !("membershipStatus" in authority) ||
      authenticated.authScope.type !== "tenant" ||
      authority.scope.tenantId !== authenticated.authScope.tenantId ||
      authority.membershipStatus !== "active"
    ) {
      throw new AuthorizationSubjectInactiveError();
    }
    if (
      !authority.scope.tenantSlug ||
      !authority.membershipId ||
      !positiveInteger(authority.membershipAuthorizationVersion)
    ) {
      throw new AuthorizationAuthorityInvalidError();
    }

    return Object.freeze({
      userId: authenticated.actorId,
      sessionId: authenticated.sessionId,
      scope: Object.freeze({
        type: "tenant" as const,
        tenantId: authority.scope.tenantId,
        tenantSlug: authority.scope.tenantSlug,
      }),
      membershipId: authority.membershipId,
      membershipStatus: "active" as const,
      roleKeys: catalog.roleKeys,
      permissionKeys: catalog.permissionKeys,
      userAuthorizationVersion: authority.userAuthorizationVersion,
      membershipAuthorizationVersion: authority.membershipAuthorizationVersion,
    });
  }
}
