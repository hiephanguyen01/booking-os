import type { ActiveTenantAuthorizationContext, AuthorizationContext } from "@booking-os/contracts";

export function isActiveTenantAuthorizationContext(
  authorization: AuthorizationContext,
): authorization is ActiveTenantAuthorizationContext {
  return (
    authorization.scope.type === "tenant" &&
    authorization.membershipStatus === "active" &&
    typeof authorization.membershipId === "string" &&
    authorization.membershipId.length > 0 &&
    Number.isInteger(authorization.membershipAuthorizationVersion) &&
    (authorization.membershipAuthorizationVersion ?? 0) > 0
  );
}
