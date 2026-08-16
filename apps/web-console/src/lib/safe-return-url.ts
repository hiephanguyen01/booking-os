export interface SafeReturnUrlPolicy {
  readonly fallback: string;
  readonly allowedPathPrefixes: readonly string[];
}

const SAFE_RETURN_ORIGIN = "https://booking.invalid";

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) {
      return true;
    }
  }

  return false;
}

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
    hasControlCharacters(value)
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
    hasControlCharacters(decodedPathname) ||
    !policy.allowedPathPrefixes.some((prefix) => matchesAllowedPrefix(decodedPathname, prefix))
  ) {
    return policy.fallback;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
