export interface ConsoleSessionSummary {
  readonly state: string;
  readonly scope:
    | { readonly type: "platform" }
    | { readonly type: "tenant"; readonly tenantId?: string };
}

function isActivePlatform(session: ConsoleSessionSummary): boolean {
  return session.state === "active" && session.scope.type === "platform";
}

function isActiveTenant(session: ConsoleSessionSummary): boolean {
  return session.state === "active" && session.scope.type === "tenant";
}

function isPathWithin(pathname: string, root: string): boolean {
  return pathname === root || pathname.startsWith(`${root}/`);
}

export function canAccessConsolePath(pathname: string, session: ConsoleSessionSummary): boolean {
  if (isPathWithin(pathname, "/platform")) {
    return isActivePlatform(session);
  }
  if (isPathWithin(pathname, "/tenant") || isPathWithin(pathname, "/settings")) {
    return isActiveTenant(session);
  }
  return false;
}
