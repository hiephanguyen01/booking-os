export interface InvitationPendingRouteInput {
  readonly method: string;
  readonly path: string;
}

export function isInvitationPendingRouteAllowed(_input: InvitationPendingRouteInput): boolean {
  return false;
}
