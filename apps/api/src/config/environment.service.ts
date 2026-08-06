import { Inject, Injectable } from "@nestjs/common";

import { ENVIRONMENT_TOKEN } from "./environment.constants.js";
import type { Environment, IdentitySecurityConfig } from "./environment.schema.js";

@Injectable()
export class EnvironmentService {
  constructor(@Inject(ENVIRONMENT_TOKEN) private readonly values: Environment) {}

  get nodeEnvironment(): Environment["nodeEnvironment"] {
    return this.values.nodeEnvironment;
  }

  get isDevelopment(): boolean {
    return this.values.nodeEnvironment === "development";
  }

  get isTest(): boolean {
    return this.values.nodeEnvironment === "test";
  }

  get isProduction(): boolean {
    return this.values.nodeEnvironment === "production";
  }

  get host(): string {
    return this.values.host;
  }

  get trustProxy(): boolean {
    return this.values.trustProxy;
  }

  get tenantBaseDomain(): string {
    return this.values.tenantBaseDomain;
  }

  get port(): number {
    return this.values.port;
  }

  get apiPrefix(): string {
    return this.values.apiPrefix;
  }

  get appVersion(): string {
    return this.values.appVersion;
  }

  get logLevel(): Environment["logLevel"] {
    return this.values.logLevel;
  }

  get databaseUrl(): string {
    return this.values.databaseUrl;
  }

  get redisUrl(): string {
    return this.values.redisUrl;
  }

  get readinessTimeoutMs(): number {
    return this.values.readinessTimeoutMs;
  }

  get sessionSecret(): string {
    return this.values.sessionSecret;
  }

  get sessionAllowedOrigins(): Environment["sessionAllowedOrigins"] {
    return this.values.sessionAllowedOrigins;
  }

  get paymentProvider(): Environment["paymentProvider"] {
    return this.values.paymentProvider;
  }

  get identitySecurity(): IdentitySecurityConfig {
    const identitySecurity = this.values.identitySecurity;

    if (!identitySecurity) {
      throw new Error("Identity security configuration is unavailable.");
    }

    return identitySecurity;
  }
}
