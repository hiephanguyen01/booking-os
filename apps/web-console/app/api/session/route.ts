import type { OpaqueSessionStore } from "@booking-os/auth";

import { csrfOriginMismatchResponse, hasMatchingOrigin } from "../../../src/lib/session/csrf";
import {
  readSessionToken,
  serializeExpiredSessionCookie,
  serializeSessionCookie,
} from "../../../src/lib/session/session-cookie";
import { sessionStore } from "../../../src/lib/session/session-store";

export interface SessionRouteHandlers {
  readonly GET: (request: Request) => Promise<Response>;
  readonly POST: (request: Request) => Promise<Response>;
  readonly DELETE: (request: Request) => Promise<Response>;
}

function unauthorizedResponse(): Response {
  return Response.json(
    {
      error: {
        code: "SESSION_UNAVAILABLE",
        message: "The console session is unavailable.",
      },
    },
    { status: 401 },
  );
}

function requestToken(request: Request): string | undefined {
  return readSessionToken(request.headers.get("cookie"));
}

export function createSessionRouteHandlers(store: OpaqueSessionStore): SessionRouteHandlers {
  return {
    async GET(request): Promise<Response> {
      const token = requestToken(request);
      const session = token ? await store.read(token) : null;

      return Response.json({ session });
    },

    async POST(request): Promise<Response> {
      if (!hasMatchingOrigin(request)) {
        return csrfOriginMismatchResponse();
      }

      const token = requestToken(request);
      const rotated = token ? await store.rotate(token) : null;

      if (!rotated) {
        return unauthorizedResponse();
      }

      return Response.json(
        { session: rotated.session },
        {
          headers: {
            "set-cookie": serializeSessionCookie(rotated.token),
          },
        },
      );
    },

    async DELETE(request): Promise<Response> {
      if (!hasMatchingOrigin(request)) {
        return csrfOriginMismatchResponse();
      }

      const token = requestToken(request);

      if (token) {
        await store.revoke(token);
      }

      return new Response(null, {
        status: 204,
        headers: {
          "set-cookie": serializeExpiredSessionCookie(),
        },
      });
    },
  };
}

const handlers = createSessionRouteHandlers(sessionStore);

export const GET = handlers.GET;
export const POST = handlers.POST;
export const DELETE = handlers.DELETE;
