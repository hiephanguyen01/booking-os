import { createSessionRouteHandlers } from "../../../src/lib/session/session-route-handlers";
import { sessionStore } from "../../../src/lib/session/session-store";

const handlers = createSessionRouteHandlers(sessionStore);

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
