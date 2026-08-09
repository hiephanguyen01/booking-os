import type { AuthorizationContext } from "@booking-os/contracts";

import type {
  AuthenticatedRequestContext,
  AuthorizationReadyRequestContext,
} from "../../../../common/request-context/request-context.types.js";
import { AuthorizationSubjectInactiveError } from "../../domain/authorization.errors.js";
import type { SessionAuthorizationRefreshPort } from "../ports/session-authorization-refresh.port.js";

interface AuthorizationContextBuilder {
  execute(authenticated: AuthenticatedRequestContext): Promise<AuthorizationContext>;
}

export interface ReconcileAuthorizationVersionInput {
  readonly authenticated: AuthorizationReadyRequestContext;
  readonly presentedToken: string;
}

export type AuthorizationReconciliationResult =
  | { readonly status: "current"; readonly context: AuthorizationContext }
  | {
      readonly status: "refreshed";
      readonly context: AuthorizationContext;
      readonly successorToken: string;
    };

export class ReconcileAuthorizationVersionUseCase {
  constructor(
    private readonly buildAuthorization: AuthorizationContextBuilder,
    private readonly sessions: SessionAuthorizationRefreshPort,
  ) {}

  async execute(
    input: ReconcileAuthorizationVersionInput,
  ): Promise<AuthorizationReconciliationResult> {
    let context: AuthorizationContext;
    try {
      context = await this.buildAuthorization.execute(input.authenticated);
    } catch (error) {
      if (error instanceof AuthorizationSubjectInactiveError) {
        await this.sessions.revoke({
          sessionId: input.authenticated.sessionId,
          userId: input.authenticated.actorId,
          requestId: input.authenticated.requestId,
          reason: "authorization_subject_inactive",
        });
      }
      throw error;
    }

    const userChanged =
      context.userAuthorizationVersion !== input.authenticated.authorizationVersion;
    const membershipChanged =
      context.scope.type === "tenant" &&
      context.membershipAuthorizationVersion !== input.authenticated.membershipAuthorizationVersion;
    if (!userChanged && !membershipChanged) {
      return Object.freeze({ status: "current", context });
    }

    const rotation = await this.sessions.refreshAndRotate({
      sessionId: input.authenticated.sessionId,
      userId: input.authenticated.actorId,
      userAuthorizationVersion: context.userAuthorizationVersion,
      ...(context.membershipAuthorizationVersion === undefined
        ? {}
        : { membershipAuthorizationVersion: context.membershipAuthorizationVersion }),
      presentedToken: input.presentedToken,
      requestId: input.authenticated.requestId,
      reason: "authorization_version_changed",
    });
    return Object.freeze({
      status: "refreshed",
      context,
      successorToken: rotation.successorToken,
    });
  }
}
