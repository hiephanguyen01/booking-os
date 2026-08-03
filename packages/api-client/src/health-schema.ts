import {
  HEALTH_STATUSES,
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
  .strict();

export const healthResponseSchema: z.ZodType<HealthResponse> = z
  .object({
    service: z.string().min(1),
    status: healthStatusSchema,
    version: z.string().min(1),
    timestamp: z.string().datetime({ offset: true }),
    uptimeSeconds: z.number().finite().nonnegative(),
    dependencies: z
      .record(z.string().min(1), healthDependencyStatusSchema)
      .optional(),
  })
  .strict();
