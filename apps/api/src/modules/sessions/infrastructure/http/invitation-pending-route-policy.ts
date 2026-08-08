export interface InvitationPendingRoute {
  readonly method: string;
  readonly path: string;
}

const ALLOWED_INVITATION_PENDING_ROUTES = new Set<string>([
  "GET /auth/session/csrf",
  "GET /auth/me",
  "POST /auth/logout",
  "POST /auth/password/reset",
  "GET /membership/invitations/current",
  "POST /membership/invitations/accept",
]);

export function isInvitationPendingRouteAllowed(route: InvitationPendingRoute): boolean {
  return ALLOWED_INVITATION_PENDING_ROUTES.has(`${route.method} ${route.path}`);
}
