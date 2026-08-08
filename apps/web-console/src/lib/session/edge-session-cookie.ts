export const EDGE_BOOKING_SESSION_COOKIE = "__Host-booking_session";

const OPAQUE_SESSION_PATTERN = /^[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{43}$/u;

function cookieValue(cookieHeader: string, name: string): string | undefined {
  for (const segment of cookieHeader.split(";")) {
    const [candidateName, ...valueParts] = segment.trim().split("=");
    if (candidateName !== name) continue;
    const encodedValue = valueParts.join("=");
    if (encodedValue === "") return undefined;
    try {
      return decodeURIComponent(encodedValue);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function readEdgeSessionToken(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  const token = cookieValue(cookieHeader, EDGE_BOOKING_SESSION_COOKIE);
  return token !== undefined && OPAQUE_SESSION_PATTERN.test(token) ? token : undefined;
}
