import type { OutboxJobPayload } from "../outbox/outbox-event.js";
import { IdentityEmailDeliveryError } from "./identity-email-error.js";

export const IDENTITY_ACTIVATION_EVENT = "identity.activation.requested.v1" as const;
export const IDENTITY_PASSWORD_RESET_EVENT = "identity.password_reset.requested.v1" as const;

export type IdentityEmailEventType =
  | typeof IDENTITY_ACTIVATION_EVENT
  | typeof IDENTITY_PASSWORD_RESET_EVENT;
export type IdentityEmailTemplate = "account_activation" | "password_reset";

export interface IdentityEmailEnvelope {
  readonly version: 1;
  readonly keyId: string;
  readonly iv: string;
  readonly ciphertext: string;
  readonly tag: string;
}

export interface ParsedIdentityEmailEvent {
  readonly eventId: string;
  readonly eventType: IdentityEmailEventType;
  readonly userId: string;
  readonly recipient: string;
  readonly hostname: string;
  readonly template: IdentityEmailTemplate;
  readonly envelope: IdentityEmailEnvelope;
}

const SAFE_HOSTNAME_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/;
const SIMPLE_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function invalidEvent(): never {
  throw new IdentityEmailDeliveryError("identity_email.event_invalid", false);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return invalidEvent();
  }
  return value;
}

export function isIdentityEmailEventType(value: string): value is IdentityEmailEventType {
  return value === IDENTITY_ACTIVATION_EVENT || value === IDENTITY_PASSWORD_RESET_EVENT;
}

function expectedTemplate(eventType: IdentityEmailEventType): IdentityEmailTemplate {
  return eventType === IDENTITY_ACTIVATION_EVENT ? "account_activation" : "password_reset";
}

export function parseIdentityEmailEvent(
  name: string,
  data: OutboxJobPayload,
): ParsedIdentityEmailEvent {
  if (!isIdentityEmailEventType(name) || data.aggregateType !== "user") {
    return invalidEvent();
  }

  const eventId = nonEmptyString(data.eventId);
  const userId = nonEmptyString(data.aggregateId);
  if (!isRecord(data.payload) || data.payload.version !== 1) {
    return invalidEvent();
  }

  const recipient = nonEmptyString(data.payload.recipient);
  const hostname = nonEmptyString(data.payload.hostname).toLowerCase();
  const template = nonEmptyString(data.payload.template);
  const envelope = data.payload.envelope;

  if (
    !SIMPLE_EMAIL_PATTERN.test(recipient) ||
    recipient.includes("\r") ||
    recipient.includes("\n") ||
    !SAFE_HOSTNAME_PATTERN.test(hostname) ||
    template !== expectedTemplate(name) ||
    !isRecord(envelope) ||
    envelope.version !== 1
  ) {
    return invalidEvent();
  }

  return Object.freeze({
    eventId,
    eventType: name,
    userId,
    recipient,
    hostname,
    template,
    envelope: Object.freeze({
      version: 1,
      keyId: nonEmptyString(envelope.keyId),
      iv: nonEmptyString(envelope.iv),
      ciphertext: nonEmptyString(envelope.ciphertext),
      tag: nonEmptyString(envelope.tag),
    }),
  });
}
