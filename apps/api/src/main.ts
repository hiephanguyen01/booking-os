import "reflect-metadata";

import { createStructuredLogger } from "@booking-os/observability";
import { NestFactory } from "@nestjs/core";
import { config as loadDotenv } from "dotenv";

import { AppModule } from "./app.module.js";
import { logApiBootstrapFailure, logApiReady } from "./bootstrap-events.js";
import { ApiExceptionFilter } from "./common/errors/api-exception.filter.js";
import { RequestContextStorage } from "./common/request-context/request-context.storage.js";
import { EnvironmentService } from "./config/environment.service.js";

loadDotenv({
  path: process.env.ENV_FILE ?? ".env",
});

let activeRequestContextStorage: RequestContextStorage | undefined;

const logger = createStructuredLogger({
  service: "api",
  contextProvider: () => {
    const context = activeRequestContextStorage?.get();

    if (!context) {
      return undefined;
    }

    return {
      requestId: context.requestId,
      traceId: context.traceId,
      ...(context.actorId === undefined ? {} : { actorId: context.actorId }),
      ...(context.tenantId === undefined ? {} : { tenantId: context.tenantId }),
    };
  },
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const environment = app.get(EnvironmentService);
  const requestContextStorage = app.get(RequestContextStorage);
  activeRequestContextStorage = requestContextStorage;

  app.enableShutdownHooks();
  app.setGlobalPrefix(environment.apiPrefix);
  app.useGlobalFilters(new ApiExceptionFilter(requestContextStorage, logger));

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
