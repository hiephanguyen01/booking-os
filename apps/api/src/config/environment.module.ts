import { Global, Module } from "@nestjs/common";

import { ENVIRONMENT_TOKEN } from "./environment.constants.js";
import { parseEnvironment } from "./environment.js";
import { EnvironmentService } from "./environment.service.js";

@Global()
@Module({
  providers: [
    {
      provide: ENVIRONMENT_TOKEN,
      useFactory: () => parseEnvironment(process.env),
    },
    EnvironmentService,
  ],
  exports: [EnvironmentService],
})
export class EnvironmentModule {}
