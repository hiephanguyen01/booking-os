import type { StoredActivationToken, StoredResetToken } from "./identity-repository.port.js";
import type { SensitiveEnvelopeValue } from "./sensitive-envelope.port.js";

export type IdentityEmailTemplate = "account_activation" | "password_reset";

export interface IdentityEmailEventPayload {
  readonly version: 1;
  readonly recipient: string;
  readonly template: IdentityEmailTemplate;
  readonly hostname: string;
  readonly envelope: SensitiveEnvelopeValue;
}

export interface IdentityEmailOutboxEvent {
  readonly id: string;
  readonly type: "identity.activation.requested.v1" | "identity.password_reset.requested.v1";
  readonly tenantId: string | null;
  readonly aggregateType: "user";
  readonly aggregateId: string;
  readonly payload: IdentityEmailEventPayload;
  readonly occurredAt: Date;
}

export interface IssueActivationEmailInput {
  readonly token: StoredActivationToken;
  readonly event: IdentityEmailOutboxEvent & {
    readonly type: "identity.activation.requested.v1";
  };
}

export interface IssuePasswordResetEmailInput {
  readonly token: StoredResetToken;
  readonly event: IdentityEmailOutboxEvent & {
    readonly type: "identity.password_reset.requested.v1";
  };
}

export type IssueIdentityEmailInput = IssueActivationEmailInput | IssuePasswordResetEmailInput;

export interface IdentityOutboxPort {
  issueActivation(input: IssueActivationEmailInput): Promise<void>;
  issuePasswordReset(input: IssuePasswordResetEmailInput): Promise<void>;
}
