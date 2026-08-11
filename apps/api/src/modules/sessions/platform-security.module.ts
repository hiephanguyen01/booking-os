import { Module } from "@nestjs/common";

import { RequestContextModule } from "../../common/request-context/request-context.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import type { AuthMetricsPort } from "../../observability/auth-metrics.port.js";
import { AuthorizationModule } from "../authorization/authorization.module.js";
import type { PlatformSessionRevocationPort } from "./application/ports/platform-session-revocation.port.js";
import { AdminRevokeUserSessionsUseCase } from "./application/use-cases/admin-revoke-user-sessions.use-case.js";
import { PlatformSecurityController } from "./infrastructure/http/platform-security.controller.js";
import { PrismaPlatformSessionRevocationAdapter } from "./infrastructure/persistence/prisma/prisma-platform-session-revocation.adapter.js";
import { SessionsModule } from "./sessions.module.js";
import { AUTH_METRICS_PORT, PLATFORM_SESSION_REVOCATION_PORT } from "./sessions.tokens.js";

@Module({
  imports: [AuthorizationModule, RequestContextModule, DatabaseModule, SessionsModule],
  controllers: [PlatformSecurityController],
  providers: [
    {
      provide: PLATFORM_SESSION_REVOCATION_PORT,
      useClass: PrismaPlatformSessionRevocationAdapter,
    },
    {
      provide: AdminRevokeUserSessionsUseCase,
      inject: [PLATFORM_SESSION_REVOCATION_PORT, AUTH_METRICS_PORT],
      useFactory: (
        mutations: PlatformSessionRevocationPort,
        metrics: AuthMetricsPort,
      ): AdminRevokeUserSessionsUseCase => new AdminRevokeUserSessionsUseCase(mutations, metrics),
    },
  ],
})
export class PlatformSecurityModule {}
