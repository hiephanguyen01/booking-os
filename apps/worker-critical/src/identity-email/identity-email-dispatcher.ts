import { IdentityEmailDeliveryError } from "./identity-email-error.js";
import { parseIdentityEmailEvent } from "./identity-email-event.js";
import { decryptIdentityEmailToken } from "./sensitive-envelope.js";

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
  template: "account_activation" | "password_reset",
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

  const link = `https://${hostname}/password/reset#token=${encodedToken}`;
  return Object.freeze({
    to: recipient,
    subject: "Reset your Booking OS password",
    text: `Open this link to reset your Booking OS password:\n\n${link}\n\nThis link can be used once and expires in 30 minutes.`,
  });
}

export class IdentityEmailDispatcher {
  constructor(
    private readonly sender: IdentityEmailSender,
    private readonly keyring: Readonly<Record<string, Uint8Array>>,
  ) {}

  async dispatch(name: string, data: Parameters<typeof parseIdentityEmailEvent>[1]) {
    const event = parseIdentityEmailEvent(name, data);
    const token = decryptIdentityEmailToken(event, this.keyring);
    const message = messageFor(event.template, event.hostname, token, event.recipient);

    try {
      await this.sender.send(message);
    } catch (error: unknown) {
      if (error instanceof IdentityEmailDeliveryError) {
        throw error;
      }
      throw new IdentityEmailDeliveryError("identity_email.smtp_temporary", true);
    }

    return Object.freeze({ eventId: event.eventId, status: "sent" as const });
  }
}
