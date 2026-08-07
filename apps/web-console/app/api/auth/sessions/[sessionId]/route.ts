import { sessionBffHandlers } from "../../../../../src/lib/session/session-route-runtime";

interface RouteContext {
  readonly params: Promise<{ readonly sessionId: string }>;
}

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const { sessionId } = await context.params;
  return sessionBffHandlers.revokeSession(request, sessionId);
}
