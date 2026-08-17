export interface IdentityTokenLocation {
  readonly hash: string;
  readonly pathname: string;
  readonly search: string;
}

export interface IdentityTokenHistory {
  replaceState(data: unknown, unused: string, url?: string | URL | null): void;
}

export type ActivationFragment =
  | { readonly kind: "activation"; readonly token: string }
  | {
      readonly kind: "owner_onboarding";
      readonly activationToken: string;
      readonly invitationToken: string;
    };

function consumeFragmentEntries(
  location: IdentityTokenLocation,
  history: IdentityTokenHistory,
): readonly [string, string][] | null {
  const hash = location.hash;
  if (hash.length === 0) return null;

  history.replaceState(null, "", `${location.pathname}${location.search}`);
  try {
    const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
    return [...new URLSearchParams(fragment).entries()];
  } catch {
    return null;
  }
}

export function consumeIdentityTokenFragment(
  location: IdentityTokenLocation,
  history: IdentityTokenHistory,
): string | null {
  const entries = consumeFragmentEntries(location, history);
  if (entries?.length !== 1 || entries[0]?.[0] !== "token") return null;
  return entries[0]?.[1] || null;
}

export function consumeActivationFragment(
  location: IdentityTokenLocation,
  history: IdentityTokenHistory,
): ActivationFragment | null {
  const entries = consumeFragmentEntries(location, history);
  if (!entries) return null;

  if (entries.length === 1 && entries[0]?.[0] === "token" && entries[0]?.[1]) {
    return Object.freeze({ kind: "activation", token: entries[0][1] });
  }

  if (
    entries.length === 2 &&
    entries[0]?.[0] === "activation" &&
    entries[0]?.[1] &&
    entries[1]?.[0] === "invitation" &&
    entries[1]?.[1]
  ) {
    return Object.freeze({
      kind: "owner_onboarding",
      activationToken: entries[0][1],
      invitationToken: entries[1][1],
    });
  }

  return null;
}

export function consumeInvitationContinuationFragment(
  location: IdentityTokenLocation,
  history: IdentityTokenHistory,
): string | null {
  const entries = consumeFragmentEntries(location, history);
  if (entries?.length !== 1 || entries[0]?.[0] !== "invitation") return null;
  return entries[0]?.[1] || null;
}
