export const BOOKING_OS_SESSION_COOKIE = "booking_os_session";
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function cookieValue(cookieHeader: string, name: string): string | undefined {
  for (const segment of cookieHeader.split(";")) {
    const [candidateName, ...valueParts] = segment.trim().split("=");

    if (candidateName === name) {
      const value = valueParts.join("=");
      return value.length > 0 ? decodeURIComponent(value) : undefined;
    }
  }

  return undefined;
}

export function readSessionToken(cookieHeader: string | null): string | undefined {
  return cookieHeader ? cookieValue(cookieHeader, BOOKING_OS_SESSION_COOKIE) : undefined;
}

export function serializeSessionCookie(
  token: string,
  nodeEnvironment: string | undefined = process.env.NODE_ENV,
): string {
  const attributes = [
    `${BOOKING_OS_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`,
  ];

  if (nodeEnvironment === "production") {
    attributes.push("Secure");
  }

  return attributes.join("; ");
}

export function serializeExpiredSessionCookie(): string {
  return `${BOOKING_OS_SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
}
