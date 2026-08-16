import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_INTERCEPTOR, DiscoveryModule } from "@nestjs/core";

import { HttpSecurityInterceptor } from "./common/http/http-security.interceptor.js";
import { HttpSecurityMiddleware } from "./common/http/http-security.middleware.js";
import { RequestContextModule } from "./common/request-context/request-context.module.js";
import { EnvironmentModule } from "./config/environment.module.js";
import { DatabaseModule } from "./database/database.module.js";
import { DependenciesModule } from "./dependencies/dependencies.module.js";
import { HealthModule } from "./health/health.module.js";
import { AuthorizationModule } from "./modules/authorization/authorization.module.js";
import { AuthorizationController } from "./modules/authorization/infrastructure/http/authorization.controller.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { NestIdentityPublicController } from "./modules/identity/infrastructure/http/identity-public.nest.controller.js";
import { PlatformTenantsController } from "./modules/memberships/infrastructure/http/platform-tenants.controller.js";
import { TenantInvitationsController } from "./modules/memberships/infrastructure/http/tenant-invitations.controller.js";
import { TenantMembershipsController } from "./modules/memberships/infrastructure/http/tenant-memberships.controller.js";
import { MembershipsModule } from "./modules/memberships/memberships.module.js";
import { PlatformSecurityController } from "./modules/sessions/infrastructure/http/platform-security.controller.js";
import { SessionAuthMiddleware } from "./modules/sessions/infrastructure/http/session-auth.middleware.js";
import { SessionCsrfHttpController } from "./modules/sessions/infrastructure/http/session-csrf-http.controller.js";
import { SessionHttpController } from "./modules/sessions/infrastructure/http/session-http.controller.js";
import { PlatformSecurityModule } from "./modules/sessions/platform-security.module.js";
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
    AuthorizationModule,
    IdentityModule,
    MembershipsModule,
    TenancyModule,
    SessionsModule,
    PlatformSecurityModule,
    ReliabilityModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: HttpSecurityInterceptor }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(HttpSecurityMiddleware)
      .forRoutes(
        AuthorizationController,
        NestIdentityPublicController,
        TenantInvitationsController,
        SessionHttpController,
        SessionCsrfHttpController,
      );
    consumer
      .apply(SessionAuthMiddleware)
      .forRoutes(PlatformTenantsController, PlatformSecurityController);
    consumer.apply(TenantResolutionMiddleware).forRoutes(NestIdentityPublicController);
    consumer
      .apply(TenantResolutionMiddleware, SessionAuthMiddleware)
      .forRoutes(
        AuthorizationController,
        TenantInvitationsController,
        TenantMembershipsController,
        SessionHttpController,
        SessionCsrfHttpController,
      );
  }
}
