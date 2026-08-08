import type { AuthorizationContext } from "@booking-os/contracts";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import type { TenantTransactionPort } from "../../../tenancy/application/ports/tenant-transaction.port.js";

export class TenantAuthorizationDeniedError extends Error {
  constructor() {
    super("Tenant authorization is unavailable.");
    this.name = "TenantAuthorizationDeniedError";
  }
}

export class BuildTenantAuthorizationContextUseCase {
  constructor(private readonly transactions: TenantTransactionPort) {}

  async execute(authenticated: AuthenticatedRequestContext): Promise<AuthorizationContext> {
    if (authenticated.authScope.type !== "tenant" || authenticated.sessionState !== "active") {
      throw new TenantAuthorizationDeniedError();
    }

    const tenantId = authenticated.authScope.tenantId;
    const authority = await this.transactions.run(
      {
        tenantId,
        requestId: authenticated.requestId,
        traceId: authenticated.traceId,
        source: authenticated.source,
        actorId: authenticated.actorId,
      },
      (session) => session.authorization.loadActiveTenantAuthorization(authenticated.actorId),
    );
    if (!authority) throw new TenantAuthorizationDeniedError();

    return Object.freeze({
      userId: authenticated.actorId,
      sessionId: authenticated.sessionId,
      scope: Object.freeze({ type: "tenant", tenantId, tenantSlug: authority.tenantSlug }),
      membershipId: authority.membershipId,
      membershipStatus: authority.membershipStatus,
      roleKeys: authority.roleKeys,
      permissionKeys: authority.permissionKeys,
      userAuthorizationVersion: authenticated.authorizationVersion,
      membershipAuthorizationVersion: authority.membershipAuthorizationVersion,
    });
  }
}
