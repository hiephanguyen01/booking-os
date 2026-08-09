import type { AuthorizationContext } from "@booking-os/contracts";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";

export interface ProtectedRequestAuthorizationPort {
  execute(authenticated: AuthenticatedRequestContext): Promise<AuthorizationContext>;
}
