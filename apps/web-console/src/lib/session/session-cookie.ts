import {
  BOOKING_SESSION_COOKIE,
  readSessionToken,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  serializeSessionCookie as serializeAuthoritativeSessionCookie,
  serializeExpiredSessionCookie,
} from "@booking-os/auth";

export const BOOKING_OS_SESSION_COOKIE = BOOKING_SESSION_COOKIE;
export { readSessionToken, SESSION_COOKIE_MAX_AGE_SECONDS, serializeExpiredSessionCookie };

export function serializeSessionCookie(
  token: string,
  _nodeEnvironment: string | undefined = process.env.NODE_ENV,
): string {
  return serializeAuthoritativeSessionCookie(token);
}
