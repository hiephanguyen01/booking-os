import "reflect-metadata";

import { createStructuredLogger, type StructuredLogger } from "@booking-os/observability";
import { NestFactory } from "@nestjs/core";
import type { Worker } from "bullmq";
import { config as loadDotenv } from "dotenv";

import { AppModule } from "./app.module.js";
import { SERVICE_NAME, type WorkerConfig } from "./config/worker-config.js";
import { BULLMQ_WORKER_TOKEN, LOGGER_TOKEN, WORKER_CONFIG_TOKEN } from "./queue/tokens.js";

loadDotenv({
  path: process.env.ENV_FILE ?? ".env",
});

const bootstrapLogger = createStructuredLogger({ service: SERVICE_NAME });

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });
  const config = app.get<WorkerConfig>(WORKER_CONFIG_TOKEN);
  const logger = app.get<StructuredLogger>(LOGGER_TOKEN);
  const worker = app.get<Worker>(BULLMQ_WORKER_TOKEN);
  let fatalShutdownStarted = false;

  app.enableShutdownHooks(["SIGINT", "SIGTERM"]);

  worker.on("error", (error: Error) => {
    if (fatalShutdownStarted) {
      return;
    }

    fatalShutdownStarted = true;
    process.exitCode = 1;
    logger.error("worker.fatal", error);
    void app.close().catch((closeError: unknown) => {
      logger.error("service.shutdown_failed", closeError);
    });
  });

  logger.info("service.ready", {
    environment: config.nodeEnvironment,
    queue: config.queueName,
  });
}

bootstrap().catch((error: unknown) => {
  bootstrapLogger.error("service.bootstrap_failed", error);
  process.exitCode = 1;
});
