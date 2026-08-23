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
          scope: input.authenticated.authScope,
          requestId: input.authenticated.requestId,
          reason: "authorization_subject_inactive",
        });
      }
      throw error;
    }

    const userChanged =
      context.userAuthorizationVersion !== input.authenticated.authorizationVersion;
    const membershipChanged =
      context.scope.type !== "platform" &&
      context.membershipAuthorizationVersion !== input.authenticated.membershipAuthorizationVersion;
    const partnerChanged =
      context.scope.type === "partner" &&
      input.authenticated.authScope.type === "partner" &&
      (context.partnerAuthorizationVersion !== input.authenticated.partnerAuthorizationVersion ||
        context.partnerMembershipAuthorizationVersion !==
          input.authenticated.partnerMembershipAuthorizationVersion);
    if (!userChanged && !membershipChanged && !partnerChanged) {
      return Object.freeze({ status: "current", context });
    }

    const rotation = await this.sessions.refreshAndRotate({
      sessionId: input.authenticated.sessionId,
      userId: input.authenticated.actorId,
      scope: input.authenticated.authScope,
      userAuthorizationVersion: context.userAuthorizationVersion,
      ...(context.membershipAuthorizationVersion === undefined
        ? {}
        : { membershipAuthorizationVersion: context.membershipAuthorizationVersion }),
      ...(context.partnerAuthorizationVersion === undefined
        ? {}
        : { partnerAuthorizationVersion: context.partnerAuthorizationVersion }),
      ...(context.partnerMembershipAuthorizationVersion === undefined
        ? {}
        : {
            partnerMembershipAuthorizationVersion:
              context.partnerMembershipAuthorizationVersion,
          }),
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
