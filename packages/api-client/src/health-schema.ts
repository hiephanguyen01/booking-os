import {
  HEALTH_STATUSES,
  type HealthDependencyStatus,
  type HealthResponse,
} from "@booking-os/contracts/health";
import { z } from "zod";

const healthStatusSchema = z.enum(HEALTH_STATUSES);

const healthDependencyStatusSchema = z
  .object({
    status: healthStatusSchema,
    latencyMs: z.number().finite().nonnegative().optional(),
    message: z.string().optional(),
  })
  .strict()
  .transform(
    (value): HealthDependencyStatus => ({
      status: value.status,
      ...(value.latencyMs !== undefined ? { latencyMs: value.latencyMs } : {}),
      ...(value.message !== undefined ? { message: value.message } : {}),
    }),
  );

export const healthResponseSchema: z.ZodType<HealthResponse> = z
  .object({
    service: z.string().min(1),
    status: healthStatusSchema,
    version: z.string().min(1),
    timestamp: z.string().datetime({ offset: true }),
    uptimeSeconds: z.number().finite().nonnegative(),
    dependencies: z.record(z.string().min(1), healthDependencyStatusSchema).optional(),
  })
  .strict()
  .transform(
    (value): HealthResponse => ({
      service: value.service,
      status: value.status,
      version: value.version,
      timestamp: value.timestamp,
      uptimeSeconds: value.uptimeSeconds,
      ...(value.dependencies !== undefined ? { dependencies: value.dependencies } : {}),
    }),
  );
