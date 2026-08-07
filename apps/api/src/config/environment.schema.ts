import { Buffer } from "node:buffer";

import { z } from "zod";

import { LOG_LEVELS, NODE_ENVIRONMENTS } from "./environment.constants.js";

const hostLabelPattern = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const keyIdPattern = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;
const canonicalBase64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SECRET_KEY_BYTES = 32;

function decodeSecretKey(value: string): Buffer | null {
  if (!canonicalBase64Pattern.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, "base64");

  if (decoded.byteLength !== SECRET_KEY_BYTES || decoded.toString("base64") !== value) {
    return null;
  }

  return decoded;
}

function secretKeySchema(variableName: string) {
  return z
    .string()
    .trim()
    .transform((value, context) => {
      const decoded = decodeSecretKey(value);

      if (!decoded) {
        context.addIssue({
          code: "custom",
          message: `${variableName} must be canonical base64 encoding exactly 32 bytes`,
        });
        return z.NEVER;
      }

      return decoded;
    });
}

const envelopeKeyringSchema = z
  .string()
  .trim()
  .transform((value, context): Readonly<Record<string, Buffer>> => {
    let parsed: unknown;

    try {
      parsed = JSON.parse(value);
    } catch {
      context.addIssue({
        code: "custom",
        message: "IDENTITY_ENVELOPE_KEYS must be a JSON object of key IDs to base64 keys",
      });
      return z.NEVER;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      context.addIssue({
        code: "custom",
        message: "IDENTITY_ENVELOPE_KEYS must be a non-empty JSON object",
      });
      return z.NEVER;
    }

    const entries = Object.entries(parsed);

    if (entries.length === 0) {
      context.addIssue({
        code: "custom",
        message: "IDENTITY_ENVELOPE_KEYS must contain at least one key",
      });
      return z.NEVER;
    }

    const keyring: Record<string, Buffer> = {};

    for (const [keyId, encodedKey] of entries) {
      const decoded = typeof encodedKey === "string" ? decodeSecretKey(encodedKey.trim()) : null;

      if (!keyIdPattern.test(keyId) || !decoded) {
        context.addIssue({
          code: "custom",
          message:
            "IDENTITY_ENVELOPE_KEYS entries require a safe key ID and canonical 32-byte base64 key",
        });
        return z.NEVER;
      }

      keyring[keyId] = decoded;
    }

    return Object.freeze(keyring);
  });

const optionalBootstrapEmailSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z
    .string()
    .trim()
    .email("IDENTITY_BOOTSTRAP_ADMIN_EMAIL must be a valid email address")
    .transform((value) => value.toLowerCase())
    .optional(),
);

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

const sessionAllowedOriginsSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z
    .string()
    .trim()
    .transform((value, context): readonly string[] => {
      const origins = value.split(",").map((origin) => origin.trim());
      const seen = new Set<string>();

      for (const origin of origins) {
        let parsed: URL;

        try {
          parsed = new URL(origin);
        } catch {
          context.addIssue({
            code: "custom",
            message:
              "SESSION_ALLOWED_ORIGINS must contain canonical HTTPS origins or loopback HTTP origins",
          });
          return z.NEVER;
        }

        const allowedProtocol =
          parsed.protocol === "https:" ||
          (parsed.protocol === "http:" && isLoopbackHostname(parsed.hostname));
        const canonical =
          allowedProtocol &&
          parsed.username === "" &&
          parsed.password === "" &&
          parsed.pathname === "/" &&
          parsed.search === "" &&
          parsed.hash === "" &&
          parsed.origin === origin;

        if (!canonical || seen.has(origin)) {
          context.addIssue({
            code: "custom",
            message:
              "SESSION_ALLOWED_ORIGINS must contain unique canonical HTTPS origins or loopback HTTP origins",
          });
          return z.NEVER;
        }

        seen.add(origin);
      }

      return Object.freeze(origins);
    })
    .optional(),
);

const apiPrefixSchema = z
  .string()
  .trim()
  .min(1, "API_PREFIX cannot be empty")
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "API_PREFIX must use lowercase kebab-case without slashes");

const hostnameSchema = (variableName: string) =>
  z
    .string()
    .trim()
    .refine(
      (value) =>
        value.includes(".") && value.split(".").every((label) => hostLabelPattern.test(label)),
      `${variableName} must be a valid multi-label hostname`,
    )
    .transform((value) => value.toLowerCase());

const tenantBaseDomainSchema = hostnameSchema("TENANT_BASE_DOMAIN");
const platformHostnameSchema = hostnameSchema("PLATFORM_HOSTNAME");

const rawEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVIRONMENTS).default("development"),

    HOST: z.string().trim().min(1).default("0.0.0.0"),

    TRUST_PROXY: z.enum(["true", "false"]).default("false"),

    TENANT_BASE_DOMAIN: tenantBaseDomainSchema.optional(),

    PLATFORM_HOSTNAME: platformHostnameSchema.optional(),

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

    SESSION_ALLOWED_ORIGINS: sessionAllowedOriginsSchema,

    PAYMENT_PROVIDER: z.enum(["mock", "payos"]).default("mock"),

    IDENTITY_TOKEN_PEPPER: secretKeySchema("IDENTITY_TOKEN_PEPPER"),

    IDENTITY_ENVELOPE_KEYS: envelopeKeyringSchema,

    IDENTITY_ACTIVE_ENVELOPE_KEY_ID: z.string().trim().regex(keyIdPattern),

    IDENTITY_BOOTSTRAP_ENABLED: z.enum(["true", "false"]).default("false"),

    IDENTITY_BOOTSTRAP_ADMIN_EMAIL: optionalBootstrapEmailSchema,
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV === "production" && !values.TENANT_BASE_DOMAIN) {
      context.addIssue({
        code: "custom",
        path: ["TENANT_BASE_DOMAIN"],
        message: "TENANT_BASE_DOMAIN is required in production",
      });
    }

    if (
      values.NODE_ENV === "production" &&
      (!values.SESSION_ALLOWED_ORIGINS || values.SESSION_ALLOWED_ORIGINS.length === 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["SESSION_ALLOWED_ORIGINS"],
        message: "SESSION_ALLOWED_ORIGINS requires at least one origin in production",
      });
    }

    if (
      values.NODE_ENV === "production" &&
      values.SESSION_ALLOWED_ORIGINS?.some((origin) => new URL(origin).protocol !== "https:")
    ) {
      context.addIssue({
        code: "custom",
        path: ["SESSION_ALLOWED_ORIGINS"],
        message: "SESSION_ALLOWED_ORIGINS must use HTTPS in production",
      });
    }

    if (values.NODE_ENV === "production" && values.PAYMENT_PROVIDER === "mock") {
      context.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER"],
        message: "PAYMENT_PROVIDER cannot be mock in production",
      });
    }

    if (!Object.hasOwn(values.IDENTITY_ENVELOPE_KEYS, values.IDENTITY_ACTIVE_ENVELOPE_KEY_ID)) {
      context.addIssue({
        code: "custom",
        path: ["IDENTITY_ACTIVE_ENVELOPE_KEY_ID"],
        message: "IDENTITY_ACTIVE_ENVELOPE_KEY_ID must reference a configured envelope key",
      });
    }

    if (values.IDENTITY_BOOTSTRAP_ENABLED === "true" && !values.IDENTITY_BOOTSTRAP_ADMIN_EMAIL) {
      context.addIssue({
        code: "custom",
        path: ["IDENTITY_BOOTSTRAP_ADMIN_EMAIL"],
        message: "IDENTITY_BOOTSTRAP_ADMIN_EMAIL is required when bootstrap is enabled",
      });
    }
  });

export const environmentSchema = rawEnvironmentSchema.transform((values) => {
  const tenantBaseDomain = values.TENANT_BASE_DOMAIN ?? "example.com";

  return {
    nodeEnvironment: values.NODE_ENV,
    host: values.HOST,
    trustProxy: values.TRUST_PROXY === "true",
    tenantBaseDomain,
    platformHostname: values.PLATFORM_HOSTNAME ?? `platform.${tenantBaseDomain}`,
    port: values.PORT,
    apiPrefix: values.API_PREFIX,
    appVersion: values.APP_VERSION,
    logLevel: values.LOG_LEVEL,
    databaseUrl: values.DATABASE_URL,
    redisUrl: values.REDIS_URL,
    readinessTimeoutMs: values.READINESS_TIMEOUT_MS,
    sessionSecret: values.SESSION_SECRET,
    sessionAllowedOrigins: Object.freeze([...(values.SESSION_ALLOWED_ORIGINS ?? [])]),
    paymentProvider: values.PAYMENT_PROVIDER,
    identitySecurity: Object.freeze({
      tokenPepper: values.IDENTITY_TOKEN_PEPPER,
      envelopeKeys: values.IDENTITY_ENVELOPE_KEYS,
      activeEnvelopeKeyId: values.IDENTITY_ACTIVE_ENVELOPE_KEY_ID,
      bootstrapEnabled: values.IDENTITY_BOOTSTRAP_ENABLED === "true",
      ...(values.IDENTITY_BOOTSTRAP_ADMIN_EMAIL
        ? { bootstrapAdminEmail: values.IDENTITY_BOOTSTRAP_ADMIN_EMAIL }
        : {}),
    }),
  };
});

export type ValidatedEnvironment = z.output<typeof environmentSchema>;

export type IdentitySecurityConfig = ValidatedEnvironment["identitySecurity"];

export type Environment = Omit<
  ValidatedEnvironment,
  "identitySecurity" | "platformHostname" | "sessionAllowedOrigins"
> &
  Partial<
    Pick<ValidatedEnvironment, "identitySecurity" | "platformHostname" | "sessionAllowedOrigins">
  >;

export type RawEnvironment = z.input<typeof environmentSchema>;
