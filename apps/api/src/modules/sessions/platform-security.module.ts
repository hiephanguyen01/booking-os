import { Module } from "@nestjs/common";

import { RequestContextModule } from "../../common/request-context/request-context.module.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import type { SessionRepositoryPort } from "./application/ports/session-repository.port.js";
import { AdminRevokeUserSessionsUseCase } from "./application/use-cases/admin-revoke-user-sessions.use-case.js";
import { PlatformSecurityController } from "./infrastructure/http/platform-security.controller.js";
import { SessionsModule } from "./sessions.module.js";
import { SESSION_REPOSITORY_PORT } from "./sessions.tokens.js";

@Module({
  imports: [AuthorizationModule, RequestContextModule, SessionsModule],
  controllers: [PlatformSecurityController],
  providers: [
    {
      provide: AdminRevokeUserSessionsUseCase,
      inject: [SESSION_REPOSITORY_PORT],
      useFactory: (sessions: SessionRepositoryPort): AdminRevokeUserSessionsUseCase =>
        new AdminRevokeUserSessionsUseCase(sessions),
    },
  ],
})
export class PlatformSecurityModule {}
