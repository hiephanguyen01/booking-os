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

export function canAccessConsolePath(pathname: string, session: ConsoleSessionSummary): boolean {
  if (pathname.startsWith("/app/platform/invitation-pending")) {
    return isActivePlatform(session) || session.state === "invitation_pending";
  }
  if (pathname.startsWith("/app/invite/accept")) {
    return isActivePlatform(session) || session.state === "invitation_pending";
  }
  if (pathname.startsWith("/app/platform")) {
    return isActivePlatform(session);
  }
  if (pathname.startsWith("/app/tenant") || pathname.startsWith("/app/settings")) {
    return isActiveTenant(session);
  }
  return false;
}
