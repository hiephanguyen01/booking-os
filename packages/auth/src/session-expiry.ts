export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionExpiryWindow {
  readonly createdAt: Date;
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface SessionExpiryInput {
  readonly now: Date;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface SessionTouchInput {
  readonly now: Date;
  readonly lastSeenAt: Date;
}

export interface RefreshedSessionTouch {
  readonly lastSeenAt: Date;
  readonly idleExpiresAt: Date;
}

function timestamp(value: Date, label: string): number {
  const result = value.getTime();
  if (!Number.isFinite(result)) {
    throw new TypeError(`${label} must be a valid Date.`);
  }
  return result;
}

export function createSessionExpiry(now: Date): SessionExpiryWindow {
  const nowMs = timestamp(now, "Session creation time");
  const createdAt = new Date(nowMs);
  const absoluteExpiresAt = new Date(nowMs + SESSION_ABSOLUTE_TTL_MS);

  return {
    createdAt,
    lastSeenAt: new Date(nowMs),
    idleExpiresAt: new Date(Math.min(nowMs + SESSION_IDLE_TTL_MS, absoluteExpiresAt.getTime())),
    absoluteExpiresAt,
  };
}

export function isSessionExpired(input: SessionExpiryInput): boolean {
  const nowMs = timestamp(input.now, "Current time");
  return (
    nowMs >= timestamp(input.idleExpiresAt, "Idle expiry") ||
    nowMs >= timestamp(input.absoluteExpiresAt, "Absolute expiry")
  );
}

export function shouldTouchSession(input: SessionTouchInput): boolean {
  const elapsedMs = timestamp(input.now, "Current time") - timestamp(input.lastSeenAt, "Last seen time");
  return elapsedMs >= SESSION_TOUCH_INTERVAL_MS;
}

export function refreshSessionTouch(input: {
  readonly now: Date;
  readonly absoluteExpiresAt: Date;
}): RefreshedSessionTouch {
  const nowMs = timestamp(input.now, "Current time");
  const absoluteExpiresAtMs = timestamp(input.absoluteExpiresAt, "Absolute expiry");

  if (nowMs >= absoluteExpiresAtMs) {
    throw new RangeError("Cannot touch a session at or after absolute expiry.");
  }

  return {
    lastSeenAt: new Date(nowMs),
    idleExpiresAt: new Date(Math.min(nowMs + SESSION_IDLE_TTL_MS, absoluteExpiresAtMs)),
  };
}
