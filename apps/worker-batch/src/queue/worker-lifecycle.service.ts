import type { StructuredLogger } from "@booking-os/observability";

export interface ClosableWorker {
  close(): Promise<void>;
}

export interface QuitableRedisConnection {
  quit(): Promise<string>;
}

export class WorkerLifecycleService {
  constructor(
    private readonly worker: ClosableWorker,
    private readonly redis: QuitableRedisConnection,
    private readonly logger: StructuredLogger,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.logger.info("service.shutdown_started");
    await this.worker.close();
    await this.redis.quit();
    this.logger.info("service.shutdown_completed");
  }
}
