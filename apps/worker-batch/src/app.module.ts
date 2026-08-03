import { Module } from "@nestjs/common";

import { workerProviders } from "./queue/providers.js";

@Module({ providers: workerProviders })
export class AppModule {}
