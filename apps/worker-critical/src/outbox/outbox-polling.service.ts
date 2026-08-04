import type { StructuredLogger } from "@booking-os/observability";

import { OutboxDispatcher } from "./outbox-dispatcher.js";

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_INTERVAL_MS = 1000;

export interface OutboxPollingOptions {
  readonly batchSize?: number;
  readonly intervalMs?: number;
}

export class OutboxPollingService {
  private readonly batchSize: number;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | undefined;
  private dispatching = false;

  constructor(
    private readonly dispatcher: OutboxDispatcher,
    private readonly logger: StructuredLogger,
    options: OutboxPollingOptions = {},
  ) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  onModuleInit(): void {
    this.start();
  }

  start(): void {
    if (this.timer) {
      return;
    }

    void this.dispatch();
    this.timer = setInterval(() => void this.dispatch(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async dispatch(): Promise<void> {
    if (this.dispatching) {
      return;
    }

    this.dispatching = true;

    try {
      const summary = await this.dispatcher.dispatchBatch(this.batchSize);

      if (summary.claimed > 0) {
        this.logger.info("outbox.batch_dispatched", {
          claimed: summary.claimed,
          dispatched: summary.dispatched,
          failed: summary.failed,
          deadLettered: summary.deadLettered,
        });
      }
    } catch (error: unknown) {
      this.logger.error("outbox.dispatch_failed", error);
    } finally {
      this.dispatching = false;
    }
  }
}
