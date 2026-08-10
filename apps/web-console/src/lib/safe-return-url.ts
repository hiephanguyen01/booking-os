export interface SafeReturnUrlPolicy {
  readonly fallback: string;
  readonly allowedPathPrefixes: readonly string[];
}

const SAFE_RETURN_ORIGIN = "https://booking.invalid";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

function decodePathname(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return null;
  }
}

function matchesAllowedPrefix(pathname: string, prefix: string): boolean {
  if (!prefix.startsWith("/") || prefix.startsWith("//")) {
    return false;
  }

  const normalizedPrefix = prefix.length > 1 ? prefix.replace(/\/+$/, "") : prefix;
  return pathname === normalizedPrefix || pathname.startsWith(`${normalizedPrefix}/`);
}

export function resolveSafeReturnUrl(
  value: string | null | undefined,
  policy: SafeReturnUrlPolicy,
): string {
  if (!value || value !== value.trim()) {
    return policy.fallback;
  }
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    CONTROL_CHARACTERS.test(value)
  ) {
    return policy.fallback;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, SAFE_RETURN_ORIGIN);
  } catch {
    return policy.fallback;
  }

  if (parsed.origin !== SAFE_RETURN_ORIGIN) {
    return policy.fallback;
  }

  const decodedPathname = decodePathname(parsed.pathname);
  if (
    !decodedPathname ||
    decodedPathname.includes("\\") ||
    CONTROL_CHARACTERS.test(decodedPathname) ||
    !policy.allowedPathPrefixes.some((prefix) => matchesAllowedPrefix(decodedPathname, prefix))
  ) {
    return policy.fallback;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
