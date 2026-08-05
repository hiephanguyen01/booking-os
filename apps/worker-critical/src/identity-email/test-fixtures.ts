import { createCipheriv } from "node:crypto";

export const EVENT_ID = "11111111-1111-4111-8111-111111111111";
export const USER_ID = "22222222-2222-4222-8222-222222222222";
export const HOSTNAME = "console.example.com";
export const RECIPIENT = "owner@example.com";
export const TOKEN = `${"a".repeat(22)}.${"b".repeat(43)}`;
export const KEY_ID = "identity-v1";
export const KEY = Buffer.alloc(32, 7);

export type IdentityEventType =
  | "identity.activation.requested.v1"
  | "identity.password_reset.requested.v1";
export type IdentityTemplate = "account_activation" | "password_reset";

function associatedData(input: {
  readonly eventType: IdentityEventType;
  readonly eventId: string;
  readonly userId: string;
  readonly hostname: string;
  readonly recipient: string;
  readonly template: IdentityTemplate;
}): Buffer {
  return Buffer.from(
    [
      "booking-os:identity-email:v1",
      input.eventType,
      input.eventId,
      input.userId,
      input.hostname,
      input.recipient,
      input.template,
    ].join("\0"),
    "utf8",
  );
}

export function createIdentityEmailJob(
  overrides: {
    readonly eventType?: IdentityEventType;
    readonly template?: IdentityTemplate;
    readonly token?: string;
    readonly keyId?: string;
    readonly payloadVersion?: number;
  } = {},
) {
  const eventType = overrides.eventType ?? "identity.activation.requested.v1";
  const template = overrides.template ?? "account_activation";
  const token = overrides.token ?? TOKEN;
  const keyId = overrides.keyId ?? KEY_ID;
  const iv = Buffer.alloc(12, 3);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv, { authTagLength: 16 });
  cipher.setAAD(
    associatedData({
      eventType,
      eventId: EVENT_ID,
      userId: USER_ID,
      hostname: HOSTNAME,
      recipient: RECIPIENT,
      template,
    }),
  );
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify({ token }), "utf8")),
    cipher.final(),
  ]);

  return {
    name: eventType,
    data: {
      eventId: EVENT_ID,
      tenantId: null,
      aggregateType: "user",
      aggregateId: USER_ID,
      payload: {
        version: overrides.payloadVersion ?? 1,
        recipient: RECIPIENT,
        template,
        hostname: HOSTNAME,
        envelope: {
          version: 1,
          keyId,
          iv: iv.toString("base64url"),
          ciphertext: ciphertext.toString("base64url"),
          tag: cipher.getAuthTag().toString("base64url"),
        },
      },
    },
    keyring: Object.freeze({ [KEY_ID]: KEY }),
    token,
  } as const;
}
