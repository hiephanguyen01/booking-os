import { Module } from "@nestjs/common";

import { RequestContextModule } from "../../common/request-context/request-context.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import type { AuthorizationRepositoryPort } from "./application/ports/authorization-repository.port.js";
import type { SessionAuthorizationRefreshPort } from "./application/ports/session-authorization-refresh.port.js";
import { BuildAuthorizationContextUseCase } from "./application/use-cases/build-authorization-context.use-case.js";
import { GetCurrentAuthorizationUseCase } from "./application/use-cases/get-current-authorization.use-case.js";
import { ReconcileAuthorizationVersionUseCase } from "./application/use-cases/reconcile-authorization-version.use-case.js";
import {
  AUTHORIZATION_REPOSITORY_PORT,
  PROTECTED_REQUEST_AUTHORIZATION_PORT,
  SESSION_AUTHORIZATION_REFRESH_PORT,
} from "./authorization.tokens.js";
import { AuthorizationController } from "./infrastructure/http/authorization.controller.js";
import { PermissionGuard } from "./infrastructure/http/permission.guard.js";
import { PrismaAuthorizationRepositoryAdapter } from "./infrastructure/persistence/prisma/prisma-authorization-repository.adapter.js";
import { PrismaSessionAuthorizationRefreshAdapter } from "./infrastructure/persistence/prisma/prisma-session-authorization-refresh.adapter.js";

@Module({
  imports: [DatabaseModule, RequestContextModule, TenancyModule],
  controllers: [AuthorizationController],
  providers: [
    {
      provide: AUTHORIZATION_REPOSITORY_PORT,
      useClass: PrismaAuthorizationRepositoryAdapter,
    },
    {
      provide: BuildAuthorizationContextUseCase,
      inject: [AUTHORIZATION_REPOSITORY_PORT],
      useFactory: (repository: AuthorizationRepositoryPort): BuildAuthorizationContextUseCase =>
        new BuildAuthorizationContextUseCase(repository),
    },
    {
      provide: SESSION_AUTHORIZATION_REFRESH_PORT,
      useClass: PrismaSessionAuthorizationRefreshAdapter,
    },
    {
      provide: ReconcileAuthorizationVersionUseCase,
      inject: [BuildAuthorizationContextUseCase, SESSION_AUTHORIZATION_REFRESH_PORT],
      useFactory: (
        build: BuildAuthorizationContextUseCase,
        sessions: SessionAuthorizationRefreshPort,
      ): ReconcileAuthorizationVersionUseCase =>
        new ReconcileAuthorizationVersionUseCase(build, sessions),
    },
    {
      provide: GetCurrentAuthorizationUseCase,
      inject: [ReconcileAuthorizationVersionUseCase],
      useFactory: (authorization: ReconcileAuthorizationVersionUseCase): GetCurrentAuthorizationUseCase =>
        new GetCurrentAuthorizationUseCase(authorization),
    },
    {
      provide: PROTECTED_REQUEST_AUTHORIZATION_PORT,
      useExisting: ReconcileAuthorizationVersionUseCase,
    },
    PermissionGuard,
  ],
  exports: [
    AUTHORIZATION_REPOSITORY_PORT,
    PROTECTED_REQUEST_AUTHORIZATION_PORT,
    BuildAuthorizationContextUseCase,
    GetCurrentAuthorizationUseCase,
    ReconcileAuthorizationVersionUseCase,
    PermissionGuard,
  ],
})
export class AuthorizationModule {}
