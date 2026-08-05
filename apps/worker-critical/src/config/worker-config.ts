import { Buffer } from "node:buffer";

import { z } from "zod";

export const SERVICE_NAME = "worker-critical" as const;
export const QUEUE_NAME = "booking-critical" as const;
export const HEALTH_CHECK_JOB_NAME = "health-check" as const;

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

const nodeEnvironmentSchema = z.enum(["development", "test", "production"]);

const environmentSchema = z
  .object({
    NODE_ENV: nodeEnvironmentSchema.default("development"),
    REDIS_HOST: z.string().trim().min(1).default("127.0.0.1"),
    REDIS_PORT: z.coerce.number().int().min(1).max(65_535).default(6379),
    REDIS_USERNAME: z.string().trim().optional(),
    REDIS_PASSWORD: z.string().trim().optional(),
    IDENTITY_ENVELOPE_KEYS: envelopeKeyringSchema,
    IDENTITY_ACTIVE_ENVELOPE_KEY_ID: z.string().trim().regex(keyIdPattern),
    SMTP_HOST: z.string().trim().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535),
    SMTP_SECURE: z.enum(["true", "false"]),
    SMTP_FROM: z.string().trim().email("SMTP_FROM must be a valid email address"),
  })
  .superRefine((values, context) => {
    if (!Object.hasOwn(values.IDENTITY_ENVELOPE_KEYS, values.IDENTITY_ACTIVE_ENVELOPE_KEY_ID)) {
      context.addIssue({
        code: "custom",
        path: ["IDENTITY_ACTIVE_ENVELOPE_KEY_ID"],
        message: "IDENTITY_ACTIVE_ENVELOPE_KEY_ID must reference a configured envelope key",
      });
    }
  });

export type NodeEnvironment = z.infer<typeof nodeEnvironmentSchema>;

export interface RedisConfig {
  readonly host: string;
  readonly port: number;
  readonly username?: string;
  readonly password?: string;
}

export interface IdentityEncryptionConfig {
  readonly envelopeKeys: Readonly<Record<string, Buffer>>;
  readonly activeEnvelopeKeyId: string;
}

export interface SmtpConfig {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly from: string;
}

export interface WorkerConfig {
  readonly serviceName: typeof SERVICE_NAME;
  readonly queueName: typeof QUEUE_NAME;
  readonly healthCheckJobName: typeof HEALTH_CHECK_JOB_NAME;
  readonly nodeEnvironment: NodeEnvironment;
  readonly redis: RedisConfig;
  readonly identityEncryption: IdentityEncryptionConfig;
  readonly smtp: SmtpConfig;
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
    identityEncryption: Object.freeze({
      envelopeKeys: parsed.IDENTITY_ENVELOPE_KEYS,
      activeEnvelopeKeyId: parsed.IDENTITY_ACTIVE_ENVELOPE_KEY_ID,
    }),
    smtp: Object.freeze({
      host: parsed.SMTP_HOST,
      port: parsed.SMTP_PORT,
      secure: parsed.SMTP_SECURE === "true",
      from: parsed.SMTP_FROM,
    }),
  });
}
