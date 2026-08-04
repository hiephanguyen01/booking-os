import { PrismaClient } from "@prisma/client";
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { EnvironmentService } from "../config/environment.service.js";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(EnvironmentService) environment: EnvironmentService) {
    super({
      datasources: {
        db: { url: environment.databaseUrl },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
