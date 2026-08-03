import assert from "node:assert/strict";
import test from "node:test";

import type { StructuredLogger } from "@booking-os/observability";

import { WorkerLifecycleService } from "./worker-lifecycle.service.js";

test("worker lifecycle logs shutdown around BullMQ and Redis close", async () => {
  const order: string[] = [];
  const logger: StructuredLogger = {
    child: () => logger,
    debug: () => {},
    info: (message) => {
      order.push(message);
    },
    warn: () => {},
    error: () => {},
  };
  const service = new WorkerLifecycleService(
    {
      close: async () => {
        order.push("worker");
      },
    },
    {
      quit: async () => {
        order.push("redis");
        return "OK";
      },
    },
    logger,
  );

  await service.onApplicationShutdown();

  assert.deepEqual(order, [
    "service.shutdown_started",
    "worker",
    "redis",
    "service.shutdown_completed",
  ]);
});
