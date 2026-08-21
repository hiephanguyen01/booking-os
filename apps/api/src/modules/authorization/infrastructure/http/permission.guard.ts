import { type PermissionKey, readSessionToken, serializeSessionCookie } from "@booking-os/auth";
import type { AuthorizationContext } from "@booking-os/contracts";
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import { isAuthorizationReadyRequestContext } from "../../../../common/request-context/request-context.types.js";
import type {
  AuthorizationDenialReason,
  AuthorizationSecurityAuditPort,
} from "../../application/ports/authorization-security-audit.port.js";
import type { ProtectedRequestAuthorizationPort } from "../../application/ports/protected-request-authorization.port.js";
import {
  AUTHORIZATION_SECURITY_AUDIT_PORT,
  PROTECTED_REQUEST_AUTHORIZATION_PORT,
} from "../../authorization.tokens.js";
import {
  AuthorizationAuthorityInvalidError,
  AuthorizationSessionIneligibleError,
  AuthorizationSubjectInactiveError,
} from "../../domain/authorization.errors.js";
import {
  PERMISSION_GUARD_EXEMPT_METADATA,
  type PermissionGuardExemption,
  REQUIRES_PERMISSION_METADATA,
  type RequiredPermissionMetadata,
} from "./requires-permission.decorator.js";

const AUTHORIZATION_CONTEXT_REQUEST_KEY = Symbol("AUTHORIZATION_CONTEXT_REQUEST_KEY");

type AuthorizedRequest = Record<PropertyKey, unknown>;

interface PermissionRequest extends AuthorizedRequest {
  readonly headers?: { readonly cookie?: string | readonly string[] };
}

interface PermissionResponse {
  setHeader(name: string, value: string): void;
}

function firstHeaderValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === "string" ? value : value?.[0];
}

function requiredPermissions(
  requirement: RequiredPermissionMetadata,
): readonly [PermissionKey, ...PermissionKey[]] {
  return typeof requirement === "string" ? [requirement] : requirement;
}

function sameScope(
  authenticated: AuthenticatedRequestContext,
  authorization: AuthorizationContext,
): boolean {
  return (
    authenticated.authScope.type === authorization.scope.type &&
    (authenticated.authScope.type === "platform" ||
      (authorization.scope.type === "tenant" &&
        authenticated.authScope.tenantId === authorization.scope.tenantId))
  );
}

function isAllowed(
  authenticated: AuthenticatedRequestContext,
  authorization: AuthorizationContext,
  permissions: readonly PermissionKey[],
  reconciled: boolean,
): boolean {
  return (
    authorization.userId === authenticated.actorId &&
    authorization.sessionId === authenticated.sessionId &&
    (reconciled ||
      (authorization.userAuthorizationVersion === authenticated.authorizationVersion &&
        (authorization.scope.type === "platform" ||
          authorization.membershipAuthorizationVersion ===
            authenticated.membershipAuthorizationVersion))) &&
    sameScope(authenticated, authorization) &&
    (authorization.scope.type === "platform" ||
      (authorization.membershipStatus === "active" && Boolean(authorization.membershipId))) &&
    permissions.some((permission) => authorization.permissionKeys.includes(permission))
  );
}

function denialReason(error: unknown): AuthorizationDenialReason | null {
  if (error instanceof AuthorizationAuthorityInvalidError) return "authority_invalid";
  if (error instanceof AuthorizationSessionIneligibleError) return "session_ineligible";
  if (error instanceof AuthorizationSubjectInactiveError) return "subject_inactive";
  return null;
}

export function authorizationContextFromRequest(request: object): AuthorizationContext {
  const authorization = (request as AuthorizedRequest)[AUTHORIZATION_CONTEXT_REQUEST_KEY];
  if (!authorization) {
    throw new ForbiddenException("Authoritative authorization is required.");
  }
  return authorization as AuthorizationContext;
}

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RequestContextStorage) private readonly requestContext: RequestContextStorage,
    @Inject(PROTECTED_REQUEST_AUTHORIZATION_PORT)
    private readonly authorization: ProtectedRequestAuthorizationPort,
    @Inject(AUTHORIZATION_SECURITY_AUDIT_PORT)
    private readonly audit: AuthorizationSecurityAuditPort,
  ) {}

  private async recordDenial(
    authenticated: AuthenticatedRequestContext,
    permission: PermissionKey,
    reason: AuthorizationDenialReason,
  ): Promise<void> {
    await this.audit.recordDenied({
      eventType: "authorization.denied",
      actorUserId: authenticated.actorId,
      subjectUserId: authenticated.actorId,
      sessionId: authenticated.sessionId,
      requestId: authenticated.requestId,
      permission,
      scopeType: authenticated.authScope.type,
      tenantId: authenticated.authScope.type === "tenant" ? authenticated.authScope.tenantId : null,
      reason,
      occurredAt: new Date(),
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<RequiredPermissionMetadata>(
      REQUIRES_PERMISSION_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!requirement) {
      const exemption = this.reflector.getAllAndOverride<PermissionGuardExemption>(
        PERMISSION_GUARD_EXEMPT_METADATA,
        [context.getHandler(), context.getClass()],
      );
      if (exemption === "invitation_pending") return true;
      throw new ForbiddenException("A permission declaration is required.");
    }
    const permissions = requiredPermissions(requirement);
    const auditPermission = permissions[0];

    const authenticated = this.requestContext.getAuthenticated();
    if (!authenticated) throw new UnauthorizedException("Authentication is required.");
    if (authenticated.sessionState !== "active") {
      await this.recordDenial(authenticated, auditPermission, "session_inactive");
      throw new ForbiddenException("An active session is required.");
    }
    if (!isAuthorizationReadyRequestContext(authenticated)) {
      await this.recordDenial(authenticated, auditPermission, "authorization_snapshot_missing");
      throw new ForbiddenException("Authorization snapshots are required.");
    }
    const request = context.switchToHttp().getRequest<PermissionRequest>();
    const presentedToken = readSessionToken(firstHeaderValue(request.headers?.cookie) ?? null);
    if (!presentedToken) throw new UnauthorizedException("Authentication is required.");

    let authorization: AuthorizationContext;
    let reconciled = false;
    try {
      const result = await this.authorization.execute({ authenticated, presentedToken });
      authorization = result.context;
      if (result.status === "refreshed") {
        reconciled = true;
        context
          .switchToHttp()
          .getResponse<PermissionResponse>()
          .setHeader("Set-Cookie", serializeSessionCookie(result.successorToken));
      }
    } catch (error: unknown) {
      const reason = denialReason(error);
      if (reason) {
        await this.recordDenial(authenticated, auditPermission, reason);
        throw new ForbiddenException("Authoritative permission is required.");
      }
      throw error;
    }
    if (!isAllowed(authenticated, authorization, permissions, reconciled)) {
      await this.recordDenial(authenticated, auditPermission, "authority_mismatch");
      throw new ForbiddenException("Authoritative permission is required.");
    }

    Object.defineProperty(request, AUTHORIZATION_CONTEXT_REQUEST_KEY, {
      value: authorization,
      enumerable: false,
      configurable: false,
      writable: false,
    });
    return true;
  }
}
