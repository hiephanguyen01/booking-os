export type IdentityEmailErrorCode =
  | "identity_email.event_invalid"
  | "identity_email.envelope_invalid"
  | "identity_email.smtp_temporary"
  | "identity_email.smtp_permanent";

export class IdentityEmailDeliveryError extends Error {
  readonly code: IdentityEmailErrorCode;
  readonly retryable: boolean;

  constructor(code: IdentityEmailErrorCode, retryable: boolean) {
    super(code);
    this.name = "IdentityEmailDeliveryError";
    this.code = code;
    this.retryable = retryable;
  }
}
