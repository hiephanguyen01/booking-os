import type { PartnerAuthorizationQueryPort } from "./partner-authorization-query.port.js";
import type { PartnerRegistrationChallengeRepositoryPort } from "./partner-registration-challenge-repository.port.js";
import type { PartnerRegistrationNotifierPort } from "./partner-registration-notifier.port.js";
import type { PartnerRepositoryPort } from "./partner-repository.port.js";

export interface PartnerDataSession {
  readonly partners: PartnerRepositoryPort;
  readonly partnerAuthorization: PartnerAuthorizationQueryPort;
  readonly partnerRegistrationChallenges: PartnerRegistrationChallengeRepositoryPort;
  readonly partnerRegistrationNotifier: PartnerRegistrationNotifierPort;
}
