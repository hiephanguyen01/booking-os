import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";

import { RequestContextModule } from "./common/request-context/request-context.module.js";
import { EnvironmentModule } from "./config/environment.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { DependenciesModule } from "./dependencies/dependencies.module.js";
import { HealthModule } from "./health/health.module.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { NestIdentityPublicController } from "./modules/identity/infrastructure/http/identity-public.nest.controller.js";
import { PlatformTenantsController } from "./modules/memberships/infrastructure/http/platform-tenants.controller.js";
import { TenantInvitationsController } from "./modules/memberships/infrastructure/http/tenant-invitations.controller.js";
import { MembershipsModule } from "./modules/memberships/memberships.module.js";
import { SessionAuthMiddleware } from "./modules/sessions/infrastructure/http/session-auth.middleware.js";
import { SessionCsrfHttpController } from "./modules/sessions/infrastructure/http/session-csrf-http.controller.js";
import { SessionHttpController } from "./modules/sessions/infrastructure/http/session-http.controller.js";
import { SessionsModule } from "./modules/sessions/sessions.module.js";
import { TenantResolutionMiddleware } from "./modules/tenancy/infrastructure/http/tenant-resolution.middleware.js";
import { TenancyModule } from "./modules/tenancy/tenancy.module.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { ReliabilityModule } from "./reliability/reliability.module.js";

@Module({
  imports: [
    DiscoveryModule,
    EnvironmentModule,
    ObservabilityModule,
    RequestContextModule,
    DependenciesModule,
    DatabaseModule,
    HealthModule,
    IdentityModule,
    MembershipsModule,
    TenancyModule,
    SessionsModule,
    ReliabilityModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(SessionAuthMiddleware).forRoutes(PlatformTenantsController);
    consumer.apply(TenantResolutionMiddleware).forRoutes(NestIdentityPublicController);
    consumer
      .apply(TenantResolutionMiddleware, SessionAuthMiddleware)
      .forRoutes(TenantInvitationsController, SessionHttpController, SessionCsrfHttpController);
  }
}
