import type { AuthorizationContext } from "@booking-os/contracts";

import type { AuthenticatedRequestContext } from "../../../../common/request-context/request-context.types.js";
import type { PlatformAuthorizationPort } from "../ports/platform-authorization.port.js";

export class PlatformAuthorizationDeniedError extends Error {
  constructor() {
    super("Platform authorization is unavailable.");
    this.name = "PlatformAuthorizationDeniedError";
  }
}

export class BuildPlatformAuthorizationContextUseCase {
  constructor(private readonly authorization: PlatformAuthorizationPort) {}

  async execute(authenticated: AuthenticatedRequestContext): Promise<AuthorizationContext> {
    if (authenticated.authScope.type !== "platform" || authenticated.sessionState !== "active") {
      throw new PlatformAuthorizationDeniedError();
    }

    const snapshot = await this.authorization.loadActivePlatformAuthorization(
      authenticated.actorId,
    );
    if (
      !snapshot ||
      snapshot.userAuthorizationVersion !== authenticated.authorizationVersion ||
      snapshot.roleKeys.length === 0
    ) {
      throw new PlatformAuthorizationDeniedError();
    }

    return Object.freeze({
      userId: authenticated.actorId,
      sessionId: authenticated.sessionId,
      scope: Object.freeze({ type: "platform" }),
      roleKeys: Object.freeze([...snapshot.roleKeys]),
      permissionKeys: Object.freeze([...snapshot.permissionKeys]),
      userAuthorizationVersion: snapshot.userAuthorizationVersion,
    });
  }
}
