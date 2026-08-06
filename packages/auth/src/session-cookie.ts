import { parseSessionToken } from "./opaque-session.js";

export const BOOKING_SESSION_COOKIE = "__Host-booking_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function cookieValue(cookieHeader: string, name: string): string | undefined {
  for (const segment of cookieHeader.split(";")) {
    const [candidateName, ...valueParts] = segment.trim().split("=");
    if (candidateName !== name) {
      continue;
    }

    const encodedValue = valueParts.join("=");
    if (encodedValue.length === 0) {
      return undefined;
    }

    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function assertMaxAge(maxAgeSeconds: number): void {
  if (!Number.isSafeInteger(maxAgeSeconds) || maxAgeSeconds <= 0) {
    throw new RangeError("Session cookie Max-Age must be a positive integer number of seconds.");
  }
}

export function readSessionToken(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const token = cookieValue(cookieHeader, BOOKING_SESSION_COOKIE);
  return token && parseSessionToken(token) ? token : undefined;
}

export function serializeSessionCookie(
  token: string,
  maxAgeSeconds = SESSION_COOKIE_MAX_AGE_SECONDS,
): string {
  if (!parseSessionToken(token)) {
    throw new TypeError("Cannot serialize an invalid opaque session token.");
  }
  assertMaxAge(maxAgeSeconds);

  return [
    `${BOOKING_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${String(maxAgeSeconds)}`,
  ].join("; ");
}

export function serializeExpiredSessionCookie(): string {
  return [
    `${BOOKING_SESSION_COOKIE}=`,
    "Secure",
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    "Max-Age=0",
  ].join("; ");
}
