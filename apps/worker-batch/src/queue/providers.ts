import { createStructuredLogger, type StructuredLogger } from "@booking-os/observability";
import type { Provider } from "@nestjs/common";
import { type Job, Worker } from "bullmq";
import { Redis } from "ioredis";

import { parseWorkerConfig, type WorkerConfig } from "../config/worker-config.js";
import { createHealthCheckProcessor } from "./health-check.js";
import {
  BULLMQ_WORKER_TOKEN,
  LOGGER_TOKEN,
  REDIS_CONNECTION_TOKEN,
  WORKER_CONFIG_TOKEN,
} from "./tokens.js";
import { WorkerLifecycleService } from "./worker-lifecycle.service.js";

export const workerProviders: Provider[] = [
  {
    provide: WORKER_CONFIG_TOKEN,
    useFactory: (): WorkerConfig => parseWorkerConfig(process.env),
  },
  {
    provide: LOGGER_TOKEN,
    inject: [WORKER_CONFIG_TOKEN],
    useFactory: (config: WorkerConfig): StructuredLogger =>
      createStructuredLogger({ service: config.serviceName }),
  },
  {
    provide: REDIS_CONNECTION_TOKEN,
    inject: [WORKER_CONFIG_TOKEN],
    useFactory: async (config: WorkerConfig): Promise<Redis> => {
      const connection = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        lazyConnect: true,
        maxRetriesPerRequest: null,
        ...(config.redis.username === undefined ? {} : { username: config.redis.username }),
        ...(config.redis.password === undefined ? {} : { password: config.redis.password }),
      });
      await connection.connect();
      return connection;
    },
  },
  {
    provide: BULLMQ_WORKER_TOKEN,
    inject: [WORKER_CONFIG_TOKEN, REDIS_CONNECTION_TOKEN, LOGGER_TOKEN],
    useFactory: async (
      config: WorkerConfig,
      connection: Redis,
      logger: StructuredLogger,
    ): Promise<Worker> => {
      const processHealthCheck = createHealthCheckProcessor(logger);
      const worker = new Worker(
        config.queueName,
        async (job: Job) =>
          processHealthCheck({
            ...(job.id === undefined ? {} : { id: job.id }),
            name: job.name,
            data: job.data,
          }),
        { connection },
      );
      await worker.waitUntilReady();
      return worker;
    },
  },
  {
    provide: WorkerLifecycleService,
    inject: [BULLMQ_WORKER_TOKEN, REDIS_CONNECTION_TOKEN],
    useFactory: (worker: Worker, connection: Redis): WorkerLifecycleService =>
      new WorkerLifecycleService(worker, connection),
  },
];
