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
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.worker.close();
    await this.redis.quit();
  }
}
