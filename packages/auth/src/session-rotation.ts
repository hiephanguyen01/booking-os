export const SESSION_ROTATION_AGE_MS = 15 * 60 * 1000;
export const SESSION_TOKEN_OVERLAP_MS = 30 * 1000;

export type SessionTokenDisposition = "active" | "overlap" | "reuse" | "expired" | "revoked";

export type SessionRotationReason =
  | "age"
  | "login"
  | "elevation"
  | "credential_change"
  | "invitation_acceptance"
  | "explicit_refresh"
  | "compromise_response";

export type SessionProtocolState = "active" | "invitation_pending" | "compromised" | "revoked";

export interface SessionRotationInput {
  readonly now: Date;
  readonly issuedAt: Date;
  readonly reason?: SessionRotationReason;
}

export interface SessionTokenDispositionInput {
  readonly now: Date;
  readonly sessionState: SessionProtocolState;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
  readonly tokenExpiresAt: Date;
  readonly tokenRevokedAt?: Date | null;
  readonly replacedAt?: Date | null;
  readonly overlapUntil?: Date | null;
}

export type SessionSuccessorDecision =
  | { readonly action: "issue" }
  | { readonly action: "return_existing"; readonly successorTokenId: string }
  | { readonly action: "compromise" };

function timestamp(value: Date, label: string): number {
  const result = value.getTime();
  if (!Number.isFinite(result)) {
    throw new TypeError(`${label} must be a valid Date.`);
  }
  return result;
}

export function shouldRotateSessionToken(input: SessionRotationInput): boolean {
  const ageMs =
    timestamp(input.now, "Current time") - timestamp(input.issuedAt, "Token issue time");
  if (ageMs < 0) {
    throw new RangeError("Session token issue time cannot be in the future.");
  }

  return input.reason !== undefined && input.reason !== "age"
    ? true
    : ageMs >= SESSION_ROTATION_AGE_MS;
}

export function createSessionTokenOverlap(now: Date): {
  readonly replacedAt: Date;
  readonly overlapUntil: Date;
} {
  const nowMs = timestamp(now, "Replacement time");
  return {
    replacedAt: new Date(nowMs),
    overlapUntil: new Date(nowMs + SESSION_TOKEN_OVERLAP_MS),
  };
}

export function getSessionTokenDisposition(
  input: SessionTokenDispositionInput,
): SessionTokenDisposition {
  const nowMs = timestamp(input.now, "Current time");

  if (
    input.sessionState === "revoked" ||
    input.sessionState === "compromised" ||
    input.tokenRevokedAt != null
  ) {
    return "revoked";
  }

  if (
    nowMs >= timestamp(input.idleExpiresAt, "Idle expiry") ||
    nowMs >= timestamp(input.absoluteExpiresAt, "Absolute expiry") ||
    nowMs >= timestamp(input.tokenExpiresAt, "Token expiry")
  ) {
    return "expired";
  }

  if (input.replacedAt == null) {
    return "active";
  }

  if (input.overlapUntil != null && nowMs <= timestamp(input.overlapUntil, "Overlap expiry")) {
    return "overlap";
  }

  return "reuse";
}

export function decideSessionTokenSuccessor(input: {
  readonly now: Date;
  readonly replacedAt?: Date | null;
  readonly overlapUntil?: Date | null;
  readonly successorTokenId?: string | null;
}): SessionSuccessorDecision {
  const hasReplacement = input.replacedAt != null;
  const successorTokenId = input.successorTokenId?.trim();

  if (!hasReplacement && !successorTokenId && input.overlapUntil == null) {
    return { action: "issue" };
  }

  if (
    hasReplacement &&
    successorTokenId &&
    input.overlapUntil != null &&
    timestamp(input.now, "Current time") <= timestamp(input.overlapUntil, "Overlap expiry")
  ) {
    return { action: "return_existing", successorTokenId };
  }

  return { action: "compromise" };
}
