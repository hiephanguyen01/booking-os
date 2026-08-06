import { Controller, Inject } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";

import { SupportedApi } from "../../../../api-visibility/api-visibility.decorator.js";
import { RequestContextStorage } from "../../../../common/request-context/request-context.storage.js";
import { EnvironmentService } from "../../../../config/environment.service.js";
import { ListSessionsUseCase } from "../../application/use-cases/list-sessions.js";
import { LoginUseCase } from "../../application/use-cases/login.use-case.js";
import { RefreshSessionUseCase } from "../../application/use-cases/refresh-session.js";
import { RevokeOtherSessionsUseCase } from "../../application/use-cases/revoke-other-sessions.js";
import { RevokeSessionUseCase } from "../../application/use-cases/revoke-session.js";
import { AuthController } from "./auth.controller.js";

@SupportedApi()
@ApiTags("sessions")
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
    @Inject(RefreshSessionUseCase) refreshSessionUseCase: RefreshSessionUseCase,
  ) {
    super(
      loginUseCase,
      requestContext,
      { trustProxy: environment.trustProxy },
      revokeSessionUseCase,
      listSessionsUseCase,
      revokeOtherSessionsUseCase,
      refreshSessionUseCase,
    );
  }
}
