import { Inject, Injectable } from "@nestjs/common";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { EnvironmentService } from "../../../../config/environment.service.js";
import { CsrfGuard } from "./csrf.guard.js";
import { deriveSessionCsrfKey } from "./csrf-key.js";

@Injectable()
export class SessionCsrfGuard extends CsrfGuard {
  constructor(
    @Inject(RequestContextStorage) requestContext: RequestContextStorage,
    @Inject(EnvironmentService) environment: EnvironmentService,
  ) {
    super(requestContext, {
      allowedOrigins: environment.sessionAllowedOrigins,
      csrfKey: deriveSessionCsrfKey(environment.sessionSecret),
      trustProxy: environment.trustProxy,
    });
  }
}
