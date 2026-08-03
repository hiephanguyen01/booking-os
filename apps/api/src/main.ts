import "reflect-metadata";

import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";

const DEFAULT_PORT = 3001;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  app.enableShutdownHooks();
  app.setGlobalPrefix("api");

  const configuredPort = process.env.PORT;
  const port = configuredPort === undefined ? DEFAULT_PORT : Number.parseInt(configuredPort, 10);

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`PORT must be an integer between 1 and 65535. Received: ${configuredPort}`);
  }

  await app.listen(port, "0.0.0.0");

  Logger.log(`API listening at http://localhost:${port}/api`, "Bootstrap");
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);

  Logger.error(message, undefined, "Bootstrap");
  process.exitCode = 1;
});
