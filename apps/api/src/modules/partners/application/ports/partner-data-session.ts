import type { PartnerAuthorizationQueryPort } from "./partner-authorization-query.port.js";
import type { PartnerRepositoryPort } from "./partner-repository.port.js";

export interface PartnerDataSession {
  readonly partners: PartnerRepositoryPort;
  readonly partnerAuthorization: PartnerAuthorizationQueryPort;
}
