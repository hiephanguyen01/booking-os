import { IdentityEmailDeliveryError } from "./identity-email-error.js";
import { parseIdentityEmailEvent } from "./identity-email-event.js";
import {
  decryptIdentityEmailMaterial,
  type InitialOwnerOnboardingMaterial,
} from "./sensitive-envelope.js";

export interface IdentityEmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export interface IdentityEmailSender {
  send(message: IdentityEmailMessage): Promise<void>;
}

export interface IdentityEmailDispatchResult {
  readonly eventId: string;
  readonly status: "sent";
}

function messageFor(
  template: "account_activation" | "password_reset" | "membership_invitation",
  hostname: string,
  token: string,
  recipient: string,
): IdentityEmailMessage {
  const encodedToken = encodeURIComponent(token);

  if (template === "account_activation") {
    const link = `https://${hostname}/activate#token=${encodedToken}`;
    return Object.freeze({
      to: recipient,
      subject: "Activate your Booking OS account",
      text: `Open this link to activate your Booking OS account:\n\n${link}\n\nThis link can be used once and expires in 24 hours.`,
    });
  }

  if (template === "membership_invitation") {
    const link = `https://${hostname}/invite/accept#token=${encodedToken}`;
    return Object.freeze({
      to: recipient,
      subject: "You are invited to Booking OS",
      text: `Open this link to review and accept your Booking OS invitation:\n\n${link}\n\nThis link can be used once and expires in 24 hours.`,
    });
  }

  const link = `https://${hostname}/password/reset#token=${encodedToken}`;
  return Object.freeze({
    to: recipient,
    subject: "Reset your Booking OS password",
    text: `Open this link to reset your Booking OS password:\n\n${link}\n\nThis link can be used once and expires in 30 minutes.`,
  });
}

function onboardingMessage(
  hostname: string,
  material: InitialOwnerOnboardingMaterial,
  recipient: string,
): IdentityEmailMessage {
  const activation = encodeURIComponent(material.activationToken);
  const invitation = encodeURIComponent(material.invitationToken);
  const link = `https://${hostname}/activate#activation=${activation}&invitation=${invitation}`;
  return Object.freeze({
    to: recipient,
    subject: "Set up your Booking OS workspace",
    text: `You've been invited to set up your workspace on Booking OS.\n\nSet your password to activate your account, then you'll review your workspace invitation.\n\n${link}\n\nThis link expires in 24 hours.`,
  });
}

function invalidMaterial(): never {
  throw new IdentityEmailDeliveryError("identity_email.envelope_invalid", false);
}

export class IdentityEmailDispatcher {
  constructor(
    private readonly sender: IdentityEmailSender,
    private readonly keyring: Readonly<Record<string, Uint8Array>>,
  ) {}

  async dispatch(name: string, data: Parameters<typeof parseIdentityEmailEvent>[1]) {
    const event = parseIdentityEmailEvent(name, data);
    const material = decryptIdentityEmailMaterial(event, this.keyring);
    const message =
      event.template === "initial_owner_onboarding"
        ? typeof material === "string"
          ? invalidMaterial()
          : onboardingMessage(event.hostname, material, event.recipient)
        : typeof material === "string"
          ? messageFor(event.template, event.hostname, material, event.recipient)
          : invalidMaterial();

    try {
      await this.sender.send(message);
    } catch (error: unknown) {
      if (error instanceof IdentityEmailDeliveryError) throw error;
      throw new IdentityEmailDeliveryError("identity_email.smtp_temporary", true);
    }

    return Object.freeze({ eventId: event.eventId, status: "sent" as const });
  }
}
