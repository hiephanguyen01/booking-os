import { Module } from "@nestjs/common";

import { DatabaseModule } from "../../database/database.module.js";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import type { AuthorizationRepositoryPort } from "./application/ports/authorization-repository.port.js";
import { BuildAuthorizationContextUseCase } from "./application/use-cases/build-authorization-context.use-case.js";
import { AUTHORIZATION_REPOSITORY_PORT } from "./authorization.tokens.js";
import { PrismaAuthorizationRepositoryAdapter } from "./infrastructure/persistence/prisma/prisma-authorization-repository.adapter.js";

@Module({
  imports: [DatabaseModule, TenancyModule],
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
  ],
  exports: [AUTHORIZATION_REPOSITORY_PORT, BuildAuthorizationContextUseCase],
})
export class AuthorizationModule {}
