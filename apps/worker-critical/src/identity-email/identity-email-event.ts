import type { OutboxJobPayload } from "../outbox/outbox-event.js";
import { IdentityEmailDeliveryError } from "./identity-email-error.js";

export const IDENTITY_ACTIVATION_EVENT = "identity.activation.requested.v1" as const;
export const IDENTITY_PASSWORD_RESET_EVENT = "identity.password_reset.requested.v1" as const;
export const MEMBERSHIP_ADMIN_INVITATION_EVENT =
  "membership.admin_invitation.requested.v1" as const;

export type IdentityEmailEventType =
  | typeof IDENTITY_ACTIVATION_EVENT
  | typeof IDENTITY_PASSWORD_RESET_EVENT
  | typeof MEMBERSHIP_ADMIN_INVITATION_EVENT;
export type IdentityEmailTemplate =
  | "account_activation"
  | "password_reset"
  | "membership_invitation";

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
  readonly tenantId?: string;
  readonly invitationId?: string;
  readonly intendedRoleKey?: "tenant_admin";
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
  if (typeof value !== "string" || value.length === 0) return invalidEvent();
  return value;
}

export function isIdentityEmailEventType(value: string): value is IdentityEmailEventType {
  return (
    value === IDENTITY_ACTIVATION_EVENT ||
    value === IDENTITY_PASSWORD_RESET_EVENT ||
    value === MEMBERSHIP_ADMIN_INVITATION_EVENT
  );
}

function expectedTemplate(eventType: IdentityEmailEventType): IdentityEmailTemplate {
  if (eventType === IDENTITY_ACTIVATION_EVENT) return "account_activation";
  if (eventType === IDENTITY_PASSWORD_RESET_EVENT) return "password_reset";
  return "membership_invitation";
}

function parseEnvelope(value: unknown): IdentityEmailEnvelope {
  if (!isRecord(value) || value.version !== 1) return invalidEvent();
  return Object.freeze({
    version: 1,
    keyId: nonEmptyString(value.keyId),
    iv: nonEmptyString(value.iv),
    ciphertext: nonEmptyString(value.ciphertext),
    tag: nonEmptyString(value.tag),
  });
}

export function parseIdentityEmailEvent(
  name: string,
  data: OutboxJobPayload,
): ParsedIdentityEmailEvent {
  if (!isIdentityEmailEventType(name) || !isRecord(data.payload) || data.payload.version !== 1) {
    return invalidEvent();
  }

  const eventId = nonEmptyString(data.eventId);
  const recipient = nonEmptyString(data.payload.recipient);
  const hostname = nonEmptyString(data.payload.hostname).toLowerCase();
  if (
    !SIMPLE_EMAIL_PATTERN.test(recipient) ||
    recipient.includes("\r") ||
    recipient.includes("\n") ||
    !SAFE_HOSTNAME_PATTERN.test(hostname)
  ) {
    return invalidEvent();
  }
  const envelope = parseEnvelope(data.payload.envelope);

  if (name === MEMBERSHIP_ADMIN_INVITATION_EVENT) {
    if (data.aggregateType !== "membership_invitation") return invalidEvent();
    const tenantId = nonEmptyString(data.tenantId);
    const invitationId = nonEmptyString(data.aggregateId);
    const userId = nonEmptyString(data.payload.userId);
    if (
      data.payload.purpose !== "membership_invitation" ||
      data.payload.intendedRoleKey !== "tenant_admin"
    ) {
      return invalidEvent();
    }
    return Object.freeze({
      eventId,
      eventType: name,
      userId,
      recipient,
      hostname,
      template: "membership_invitation",
      envelope,
      tenantId,
      invitationId,
      intendedRoleKey: "tenant_admin",
    });
  }

  if (data.aggregateType !== "user") return invalidEvent();
  const userId = nonEmptyString(data.aggregateId);
  const template = nonEmptyString(data.payload.template);
  if (template !== expectedTemplate(name)) return invalidEvent();

  return Object.freeze({
    eventId,
    eventType: name,
    userId,
    recipient,
    hostname,
    template,
    envelope,
  });
}
