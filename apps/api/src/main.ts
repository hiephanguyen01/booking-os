import "reflect-metadata";

import { createStructuredLogger } from "@booking-os/observability";
import { NestFactory } from "@nestjs/core";
import { config as loadDotenv } from "dotenv";

import { AppModule } from "./app.module.js";
import { logApiBootstrapFailure, logApiReady } from "./bootstrap-events.js";
import { EnvironmentService } from "./config/environment.service.js";

loadDotenv({
  path: process.env.ENV_FILE ?? ".env",
});

const logger = createStructuredLogger({ service: "api" });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const environment = app.get(EnvironmentService);

  app.enableShutdownHooks();
  app.setGlobalPrefix(environment.apiPrefix);

  await app.listen(environment.port, environment.host);

  logApiReady(logger, {
    environment: environment.nodeEnvironment,
    address: `http://localhost:${environment.port}/${environment.apiPrefix}`,
  });
}

bootstrap().catch((error: unknown) => {
  logApiBootstrapFailure(logger, error);
  process.exitCode = 1;
});
