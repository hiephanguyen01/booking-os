import assert from "node:assert/strict";
import test from "node:test";

import { WorkerLifecycleService } from "./worker-lifecycle.service.js";

test("worker lifecycle closes BullMQ before Redis", async () => {
  const order: string[] = [];
  const service = new WorkerLifecycleService(
    { close: async () => order.push("worker") },
    {
      quit: async () => {
        order.push("redis");
        return "OK";
      },
    },
  );

  await service.onApplicationShutdown();

  assert.deepEqual(order, ["worker", "redis"]);
});
