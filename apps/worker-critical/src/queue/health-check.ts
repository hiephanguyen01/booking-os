import type { StructuredLogger } from "@booking-os/observability";
import { z } from "zod";

import { HEALTH_CHECK_JOB_NAME, SERVICE_NAME } from "../config/worker-config.js";

const healthCheckPayloadSchema = z
  .object({
    correlationId: z.string().trim().min(1),
  })
  .strict();

export interface HealthCheckJobLike {
  readonly id?: string;
  readonly name: string;
  readonly data: unknown;
}

export interface HealthCheckResult {
  readonly service: typeof SERVICE_NAME;
  readonly jobId: string;
  readonly correlationId: string;
}

export type HealthCheckProcessor = (
  job: HealthCheckJobLike,
) => Promise<HealthCheckResult>;

export function createHealthCheckProcessor(
  logger: StructuredLogger,
): HealthCheckProcessor {
  return async (job) => {
    const jobId = job.id ?? "unknown";
    const jobLogger = logger.child({ jobId, jobName: job.name });

    try {
      if (job.name !== HEALTH_CHECK_JOB_NAME) {
        throw new Error(`Expected job name ${HEALTH_CHECK_JOB_NAME}`);
      }

      const payload = healthCheckPayloadSchema.parse(job.data);
      jobLogger.info("job.started");

      const result: HealthCheckResult = {
        service: SERVICE_NAME,
        jobId,
        correlationId: payload.correlationId,
      };

      jobLogger.info("job.completed");
      return result;
    } catch (error: unknown) {
      jobLogger.error("job.failed", error);
      throw error;
    }
  };
}
