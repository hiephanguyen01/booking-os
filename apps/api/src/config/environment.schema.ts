import { z } from "zod";

import { LOG_LEVELS, NODE_ENVIRONMENTS } from "./environment.constants.js";

const hostLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

const apiPrefixSchema = z
  .string()
  .trim()
  .min(1, "API_PREFIX cannot be empty")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "API_PREFIX must use lowercase kebab-case without slashes");

const tenantBaseDomainSchema = z
  .string()
  .trim()
  .refine(
    (value) =>
      value.includes(".") && value.split(".").every((label) => hostLabelPattern.test(label)),
    "TENANT_BASE_DOMAIN must be a valid multi-label hostname",
  )
  .transform((value) => value.toLowerCase());

const rawEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVIRONMENTS).default("development"),

    HOST: z.string().trim().min(1).default("0.0.0.0"),

    TRUST_PROXY: z.enum(["true", "false"]).default("false"),

    TENANT_BASE_DOMAIN: tenantBaseDomainSchema.optional(),

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

    READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(5000).default(750),

    SESSION_SECRET: z.string().min(32, "SESSION_SECRET must contain at least 32 characters"),

    PAYMENT_PROVIDER: z.enum(["mock", "payos"]).default("mock"),
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV === "production" && !values.TENANT_BASE_DOMAIN) {
      context.addIssue({
        code: "custom",
        path: ["TENANT_BASE_DOMAIN"],
        message: "TENANT_BASE_DOMAIN is required in production",
      });
    }

    if (values.NODE_ENV === "production" && values.PAYMENT_PROVIDER === "mock") {
      context.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER"],
        message: "PAYMENT_PROVIDER cannot be mock in production",
      });
    }
  });

export const environmentSchema = rawEnvironmentSchema.transform((values) => ({
  nodeEnvironment: values.NODE_ENV,
  host: values.HOST,
  trustProxy: values.TRUST_PROXY === "true",
  tenantBaseDomain: values.TENANT_BASE_DOMAIN ?? "example.com",
  port: values.PORT,
  apiPrefix: values.API_PREFIX,
  appVersion: values.APP_VERSION,
  logLevel: values.LOG_LEVEL,
  databaseUrl: values.DATABASE_URL,
  redisUrl: values.REDIS_URL,
  readinessTimeoutMs: values.READINESS_TIMEOUT_MS,
  sessionSecret: values.SESSION_SECRET,
  paymentProvider: values.PAYMENT_PROVIDER,
}));

export type Environment = z.output<typeof environmentSchema>;

export type RawEnvironment = z.input<typeof environmentSchema>;
