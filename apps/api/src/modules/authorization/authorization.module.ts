import { Module } from "@nestjs/common";

import { RequestContextModule } from "../../common/request-context/request-context.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import type { AuthorizationRepositoryPort } from "./application/ports/authorization-repository.port.js";
import { BuildAuthorizationContextUseCase } from "./application/use-cases/build-authorization-context.use-case.js";
import {
  AUTHORIZATION_REPOSITORY_PORT,
  PROTECTED_REQUEST_AUTHORIZATION_PORT,
} from "./authorization.tokens.js";
import { PermissionGuard } from "./infrastructure/http/permission.guard.js";
import { PrismaAuthorizationRepositoryAdapter } from "./infrastructure/persistence/prisma/prisma-authorization-repository.adapter.js";

@Module({
  imports: [DatabaseModule, RequestContextModule, TenancyModule],
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
      provide: PROTECTED_REQUEST_AUTHORIZATION_PORT,
      useExisting: BuildAuthorizationContextUseCase,
    },
    PermissionGuard,
  ],
  exports: [
    AUTHORIZATION_REPOSITORY_PORT,
    PROTECTED_REQUEST_AUTHORIZATION_PORT,
    BuildAuthorizationContextUseCase,
    PermissionGuard,
  ],
})
export class AuthorizationModule {}
