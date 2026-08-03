import assert from "node:assert/strict";
import test from "node:test";

import { WorkerLifecycleService } from "./worker-lifecycle.service.js";

test("worker lifecycle closes BullMQ before Redis", async () => {
  const closeOrder: string[] = [];
  const service = new WorkerLifecycleService(
    {
      close: async () => {
        closeOrder.push("worker");
      },
    },
    {
      quit: async () => {
        closeOrder.push("redis");
        return "OK";
      },
    },
  );

  await service.onApplicationShutdown();

  assert.deepEqual(closeOrder, ["worker", "redis"]);
});
