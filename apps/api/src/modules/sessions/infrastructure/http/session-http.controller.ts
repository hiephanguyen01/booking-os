import { Controller, Inject } from "@nestjs/common";

import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { EnvironmentService } from "../../../../config/environment.service.js";
import { ListSessionsUseCase } from "../../application/use-cases/list-sessions.js";
import { LoginUseCase } from "../../application/use-cases/login.use-case.js";
import { RevokeOtherSessionsUseCase } from "../../application/use-cases/revoke-other-sessions.js";
import { RevokeSessionUseCase } from "../../application/use-cases/revoke-session.js";
import { AuthController } from "./auth.controller.js";

@Controller("auth")
export class SessionHttpController extends AuthController {
  constructor(
    @Inject(LoginUseCase) loginUseCase: LoginUseCase,
    @Inject(RequestContextStorage) requestContext: RequestContextStorage,
    @Inject(EnvironmentService) environment: EnvironmentService,
    @Inject(RevokeSessionUseCase) revokeSessionUseCase: RevokeSessionUseCase,
    @Inject(ListSessionsUseCase) listSessionsUseCase: ListSessionsUseCase,
    @Inject(RevokeOtherSessionsUseCase)
    revokeOtherSessionsUseCase: RevokeOtherSessionsUseCase,
  ) {
    super(
      loginUseCase,
      requestContext,
      { trustProxy: environment.trustProxy },
      revokeSessionUseCase,
      listSessionsUseCase,
      revokeOtherSessionsUseCase,
    );
  }
}
