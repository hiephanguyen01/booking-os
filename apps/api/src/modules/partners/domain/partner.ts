import { PartnerInvalidStateError } from "./partner.errors.js";

export type PartnerType = "individual" | "company";

export type PartnerApplicationStatus =
  | "draft"
  | "submitted"
  | "changes_requested"
  | "approved"
  | "rejected";

export type PartnerOperationalStatus = "inactive" | "active" | "suspended" | "cancelled";

export interface PartnerState {
  readonly id: string;
  readonly tenantId: string;
  readonly type: PartnerType;
  readonly applicationStatus: PartnerApplicationStatus;
  readonly operationalStatus: PartnerOperationalStatus;
  readonly authorizationVersion: number;
  readonly version: number;
  readonly submittedAt: Date | null;
  readonly approvedAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

type ApplicationState = Pick<PartnerState, "applicationStatus">;
type OperationalState = Pick<PartnerState, "operationalStatus">;
type TransitionState = Pick<PartnerState, "applicationStatus" | "operationalStatus">;

function assertState(condition: boolean): asserts condition {
  if (!condition) {
    throw new PartnerInvalidStateError();
  }
}

export function canEditApplication(partner: ApplicationState): boolean {
  return partner.applicationStatus === "draft" || partner.applicationStatus === "changes_requested";
}

export function canCreateInventory(partner: OperationalState): boolean {
  return partner.operationalStatus === "active";
}

export function assertCanSubmit(partner: TransitionState): void {
  assertState(partner.operationalStatus === "inactive" && canEditApplication(partner));
}

export function assertCanReview(partner: TransitionState): void {
  assertState(
    partner.applicationStatus === "submitted" && partner.operationalStatus === "inactive",
  );
}

export function assertCanApprove(partner: TransitionState): void {
  assertCanReview(partner);
}

export function assertCanReject(partner: TransitionState): void {
  assertCanReview(partner);
}

export function assertCanSuspend(partner: TransitionState): void {
  assertState(partner.applicationStatus === "approved" && partner.operationalStatus === "active");
}

export function assertCanReactivate(partner: TransitionState): void {
  assertState(
    partner.applicationStatus === "approved" && partner.operationalStatus === "suspended",
  );
}

export function assertCanCancel(partner: TransitionState): void {
  assertState(
    partner.applicationStatus === "approved" &&
      (partner.operationalStatus === "active" || partner.operationalStatus === "suspended"),
  );
}
