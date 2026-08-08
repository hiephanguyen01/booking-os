export interface InvitationPendingRouteInput {
  readonly method: string;
  readonly path: string;
}

const INVITATION_PENDING_ROUTES = new Set([
  "GET /auth/csrf",
  "GET /auth/me",
  "POST /auth/logout",
  "POST /auth/password/reset",
  "GET /membership/invitations/current",
  "POST /membership/invitations/accept",
]);

export function isInvitationPendingRouteAllowed(input: InvitationPendingRouteInput): boolean {
  return INVITATION_PENDING_ROUTES.has(`${input.method} ${input.path}`);
}
