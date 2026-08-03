import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { config as loadDotenv } from "dotenv";

import { AppModule } from "./app.module.js";
import { EnvironmentService } from "./config/environment.service.js";

loadDotenv({
  path: process.env.ENV_FILE ?? ".env",
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const environment = app.get(EnvironmentService);

  app.enableShutdownHooks();
  app.setGlobalPrefix(environment.apiPrefix);

  await app.listen(environment.port, environment.host);

  Logger.log(
    [
      "API started",
      `environment=${environment.nodeEnvironment}`,
      `address=http://localhost:${environment.port}/${environment.apiPrefix}`,
    ].join(" "),
    "Bootstrap",
  );
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);

  Logger.error(message, undefined, "Bootstrap");
  process.exitCode = 1;
});
