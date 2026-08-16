import type { AuthorizationContext } from "@booking-os/contracts";

import type { AuthorizationReadyRequestContext } from "../../../../common/request-context/request-context.types.js";

export interface GetCurrentAuthorizationInput {
  readonly authenticated: AuthorizationReadyRequestContext;
  readonly presentedToken: string;
}

export type GetCurrentAuthorizationResult =
  | { readonly status: "current"; readonly context: AuthorizationContext }
  | {
      readonly status: "refreshed";
      readonly context: AuthorizationContext;
      readonly successorToken: string;
    };

interface AuthorizationReconciler {
  execute(input: GetCurrentAuthorizationInput): Promise<GetCurrentAuthorizationResult>;
}

export class GetCurrentAuthorizationUseCase {
  constructor(private readonly authorization: AuthorizationReconciler) {}

  execute(input: GetCurrentAuthorizationInput): Promise<GetCurrentAuthorizationResult> {
    return this.authorization.execute(input);
  }
}
