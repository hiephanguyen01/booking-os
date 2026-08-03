import { z } from "zod";

import { LOG_LEVELS, NODE_ENVIRONMENTS } from "./environment.constants.js";

const apiPrefixSchema = z
  .string()
  .trim()
  .min(1, "API_PREFIX cannot be empty")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "API_PREFIX must use lowercase kebab-case without slashes");

export const environmentSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVIRONMENTS).default("development"),

    HOST: z.string().trim().min(1).default("0.0.0.0"),

    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),

    API_PREFIX: apiPrefixSchema.default("api"),

    APP_VERSION: z.string().trim().min(1).default("0.1.0"),

    LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),

    DATABASE_URL: z
      .string()
      .trim()
      .url("DATABASE_URL must be a valid URL")
      .refine(
        (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
        "DATABASE_URL must use the postgresql:// or postgres:// protocol",
      ),

    REDIS_URL: z
      .string()
      .trim()
      .url("REDIS_URL must be a valid URL")
      .refine(
        (value) => value.startsWith("redis://") || value.startsWith("rediss://"),
        "REDIS_URL must use the redis:// or rediss:// protocol",
      ),
  })
  .transform((values) => ({
    nodeEnvironment: values.NODE_ENV,
    host: values.HOST,
    port: values.PORT,
    apiPrefix: values.API_PREFIX,
    appVersion: values.APP_VERSION,
    logLevel: values.LOG_LEVEL,
    databaseUrl: values.DATABASE_URL,
    redisUrl: values.REDIS_URL,
  }));

export type Environment = z.output<typeof environmentSchema>;

export type RawEnvironment = z.input<typeof environmentSchema>;
