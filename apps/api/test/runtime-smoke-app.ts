import "reflect-metadata";

import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "../src/app.module.js";
import { EnvironmentService } from "../src/config/environment.service.js";

@Controller("runtime-smoke")
class RuntimeSmokeController {
  @Get("boom")
  boom(): never {
    throw new Error("runtime smoke internal detail");
  }
}

@Module({
  imports: [AppModule],
  controllers: [RuntimeSmokeController],
})
class RuntimeSmokeModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(RuntimeSmokeModule, { bufferLogs: true });
  const environment = app.get(EnvironmentService);

  app.enableShutdownHooks();
  app.setGlobalPrefix(environment.apiPrefix);
  await app.listen(environment.port, environment.host);
}

bootstrap().catch(() => {
  process.exitCode = 1;
});
