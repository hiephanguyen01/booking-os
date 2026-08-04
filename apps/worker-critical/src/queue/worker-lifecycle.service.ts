import type { StructuredLogger } from "@booking-os/observability";

export interface ClosableWorker {
  close(): Promise<void>;
}

export interface QuitableRedisConnection {
  quit(): Promise<string>;
}

export interface StoppableOutboxPolling {
  stop(): void;
}

export interface ClosableQueue {
  close(): Promise<void>;
}

export interface DisconnectableDatabase {
  $disconnect(): Promise<void>;
}

export class WorkerLifecycleService {
  constructor(
    private readonly worker: ClosableWorker,
    private readonly redis: QuitableRedisConnection,
    private readonly logger: StructuredLogger,
    private readonly outboxPolling?: StoppableOutboxPolling,
    private readonly queue?: ClosableQueue,
    private readonly database?: DisconnectableDatabase,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    this.logger.info("service.shutdown_started");
    this.outboxPolling?.stop();
    await this.worker.close();
    await this.queue?.close();
    await this.database?.$disconnect();
    await this.redis.quit();
    this.logger.info("service.shutdown_completed");
  }
}
