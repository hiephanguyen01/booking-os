import { Queue } from "bullmq";
import { config as loadDotenv } from "dotenv";
import Redis from "ioredis";

import { parseWorkerConfig } from "../config/worker-config.js";

loadDotenv({
  path: process.env.ENV_FILE ?? ".env",
});

async function enqueueHealthCheck(): Promise<void> {
  const config = parseWorkerConfig(process.env);
  const connection = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    lazyConnect: true,
    maxRetriesPerRequest: null,
    ...(config.redis.username === undefined
      ? {}
      : { username: config.redis.username }),
    ...(config.redis.password === undefined
      ? {}
      : { password: config.redis.password }),
  });
  let queue: Queue | undefined;

  try {
    await connection.connect();
    queue = new Queue(config.queueName, { connection });
    const correlationId = `smoke-${Date.now()}`;
    const job = await queue.add(config.healthCheckJobName, { correlationId });

    process.stdout.write(`${job.id ?? "unknown"}\n`);
  } finally {
    await queue?.close();
    await connection.quit();
  }
}

enqueueHealthCheck().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
