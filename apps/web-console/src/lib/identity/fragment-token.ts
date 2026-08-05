export interface IdentityTokenLocation {
  readonly hash: string;
  readonly pathname: string;
  readonly search: string;
}

export interface IdentityTokenHistory {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export function consumeIdentityTokenFragment(
  location: IdentityTokenLocation,
  history: IdentityTokenHistory,
): string | null {
  if (location.hash.length === 0) {
    return null;
  }

  history.replaceState(null, "", `${location.pathname}${location.search}`);

  try {
    const fragment = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
    const parameters = new URLSearchParams(fragment);
    const entries = [...parameters.entries()];
    const tokens = parameters.getAll("token");

    if (
      entries.length !== 1 ||
      entries[0]?.[0] !== "token" ||
      tokens.length !== 1 ||
      tokens[0]?.length === 0
    ) {
      return null;
    }

    return tokens[0] ?? null;
  } catch {
    return null;
  }
}
