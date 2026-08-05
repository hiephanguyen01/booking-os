import { createStructuredLogger, type StructuredLogger } from "@booking-os/observability";
import type { Provider } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { type Job, Queue, UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";

import { parseWorkerConfig, type WorkerConfig } from "../config/worker-config.js";
import { WorkerDatabase } from "../database/worker-database.js";
import { IdentityEmailDispatcher } from "../identity-email/identity-email-dispatcher.js";
import { IdentityEmailDeliveryError } from "../identity-email/identity-email-error.js";
import { isIdentityEmailEventType } from "../identity-email/identity-email-event.js";
import {
  NodeSmtpTransport,
  SmtpIdentityEmailAdapter,
} from "../identity-email/smtp-identity-email.adapter.js";
import { OutboxDispatcher } from "../outbox/outbox-dispatcher.js";
import type { OutboxJobPayload } from "../outbox/outbox-event.js";
import { OutboxPollingService } from "../outbox/outbox-polling.service.js";
import { PrismaOutboxRepository } from "../outbox/prisma-outbox.repository.js";
import { createHealthCheckProcessor } from "./health-check.js";
import {
  BULLMQ_QUEUE_TOKEN,
  BULLMQ_WORKER_TOKEN,
  IDENTITY_EMAIL_DISPATCHER_TOKEN,
  LOGGER_TOKEN,
  PRISMA_CLIENT_TOKEN,
  REDIS_CONNECTION_TOKEN,
  WORKER_CONFIG_TOKEN,
} from "./tokens.js";
import { WorkerLifecycleService } from "./worker-lifecycle.service.js";

function isOutboxJobPayload(value: unknown): value is OutboxJobPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const payload = value as Partial<OutboxJobPayload>;
  return (
    typeof payload.eventId === "string" &&
    typeof payload.aggregateType === "string" &&
    typeof payload.aggregateId === "string"
  );
}

async function processIdentityEmail(
  dispatcher: IdentityEmailDispatcher,
  logger: StructuredLogger,
  name: string,
  data: OutboxJobPayload,
): Promise<unknown> {
  try {
    const result = await dispatcher.dispatch(name, data);
    logger.info("identity_email.sent", {
      eventId: data.eventId,
      eventType: name,
    });
    return result;
  } catch (error: unknown) {
    const classified =
      error instanceof IdentityEmailDeliveryError
        ? error
        : new IdentityEmailDeliveryError("identity_email.smtp_temporary", true);
    logger.warn("identity_email.delivery_failed", {
      eventId: data.eventId,
      eventType: name,
      errorCode: classified.code,
      retryable: classified.retryable,
    });

    if (!classified.retryable) {
      throw new UnrecoverableError(classified.code);
    }
    throw classified;
  }
}

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
    provide: PRISMA_CLIENT_TOKEN,
    useFactory: async (): Promise<PrismaClient> => {
      const prisma = new PrismaClient();
      await prisma.$connect();
      return prisma;
    },
  },
  {
    provide: BULLMQ_QUEUE_TOKEN,
    inject: [WORKER_CONFIG_TOKEN, REDIS_CONNECTION_TOKEN],
    useFactory: async (config: WorkerConfig, connection: Redis): Promise<Queue> => {
      const queue = new Queue(config.queueName, { connection });
      await queue.waitUntilReady();
      return queue;
    },
  },
  {
    provide: IDENTITY_EMAIL_DISPATCHER_TOKEN,
    inject: [WORKER_CONFIG_TOKEN],
    useFactory: (config: WorkerConfig): IdentityEmailDispatcher => {
      const sender = new SmtpIdentityEmailAdapter(
        { from: config.smtp.from },
        new NodeSmtpTransport(config.smtp),
      );
      return new IdentityEmailDispatcher(sender, config.identityEncryption.envelopeKeys);
    },
  },
  {
    provide: BULLMQ_WORKER_TOKEN,
    inject: [
      WORKER_CONFIG_TOKEN,
      REDIS_CONNECTION_TOKEN,
      LOGGER_TOKEN,
      IDENTITY_EMAIL_DISPATCHER_TOKEN,
    ],
    useFactory: async (
      config: WorkerConfig,
      connection: Redis,
      logger: StructuredLogger,
      identityEmails: IdentityEmailDispatcher,
    ): Promise<Worker> => {
      const processHealthCheck = createHealthCheckProcessor(logger);
      const worker = new Worker(
        config.queueName,
        async (job: Job) => {
          if (isOutboxJobPayload(job.data)) {
            logger.info("outbox.event_received", {
              eventId: job.data.eventId,
              eventType: job.name,
              ...(job.data.tenantId === null ? {} : { tenantId: job.data.tenantId }),
            });
            if (isIdentityEmailEventType(job.name)) {
              return processIdentityEmail(identityEmails, logger, job.name, job.data);
            }
            return { eventId: job.data.eventId, status: "accepted" };
          }

          return processHealthCheck({
            ...(job.id === undefined ? {} : { id: job.id }),
            name: job.name,
            data: job.data,
          });
        },
        { connection },
      );

      await worker.waitUntilReady();
      return worker;
    },
  },
  {
    provide: OutboxPollingService,
    inject: [PRISMA_CLIENT_TOKEN, BULLMQ_QUEUE_TOKEN, LOGGER_TOKEN],
    useFactory: (
      prisma: PrismaClient,
      queue: Queue,
      logger: StructuredLogger,
    ): OutboxPollingService =>
      new OutboxPollingService(
        new OutboxDispatcher(new PrismaOutboxRepository(new WorkerDatabase(prisma)), queue),
        logger,
      ),
  },
  {
    provide: WorkerLifecycleService,
    inject: [
      BULLMQ_WORKER_TOKEN,
      REDIS_CONNECTION_TOKEN,
      LOGGER_TOKEN,
      OutboxPollingService,
      BULLMQ_QUEUE_TOKEN,
      PRISMA_CLIENT_TOKEN,
    ],
    useFactory: (
      worker: Worker,
      connection: Redis,
      logger: StructuredLogger,
      outboxPolling: OutboxPollingService,
      queue: Queue,
      prisma: PrismaClient,
    ): WorkerLifecycleService =>
      new WorkerLifecycleService(worker, connection, logger, outboxPolling, queue, prisma),
  },
];
