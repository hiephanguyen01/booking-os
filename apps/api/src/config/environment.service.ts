import { Inject, Injectable } from "@nestjs/common";

import { ENVIRONMENT_TOKEN } from "./environment.constants.js";
import type { Environment } from "./environment.schema.js";

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
}
