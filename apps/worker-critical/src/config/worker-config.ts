import { z } from "zod";

export const SERVICE_NAME = "worker-critical" as const;
export const QUEUE_NAME = "booking-critical" as const;
export const HEALTH_CHECK_JOB_NAME = "health-check" as const;

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);

const environmentSchema = z.object({
  NODE_ENV: nodeEnvironmentSchema.default("development"),
  REDIS_HOST: z.string().trim().min(1).default("127.0.0.1"),
  REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
  REDIS_USERNAME: z.string().trim().optional(),
  REDIS_PASSWORD: z.string().trim().optional(),
});

export type NodeEnvironment = z.infer<typeof nodeEnvironmentSchema>;

export interface RedisConfig {
  readonly host: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
}

export interface WorkerConfig {
  readonly serviceName: typeof SERVICE_NAME;
  readonly queueName: typeof QUEUE_NAME;
  readonly healthCheckJobName: typeof HEALTH_CHECK_JOB_NAME;
  readonly nodeEnvironment: NodeEnvironment;
  readonly redis: RedisConfig;
}

export function parseWorkerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): WorkerConfig {
  const parsed = environmentSchema.parse(environment);
  const username = parsed.REDIS_USERNAME || undefined;
  const password = parsed.REDIS_PASSWORD || undefined;

  return Object.freeze({
    serviceName: SERVICE_NAME,
    queueName: QUEUE_NAME,
    healthCheckJobName: HEALTH_CHECK_JOB_NAME,
    nodeEnvironment: parsed.NODE_ENV,
    redis: Object.freeze({
      host: parsed.REDIS_HOST,
      port: parsed.REDIS_PORT,
      ...(username === undefined ? {} : { username }),
      ...(password === undefined ? {} : { password }),
    }),
  });
}
