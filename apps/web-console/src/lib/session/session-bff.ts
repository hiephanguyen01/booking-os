export interface SessionBffDependencies {
  readonly apiBaseUrl: string;
  readonly fetch: typeof fetch;
}

export interface SessionBffHandlers {
  readonly sessionCsrf: (request: Request) => Promise<Response>;
  readonly login: (request: Request) => Promise<Response>;
  readonly logout: (request: Request) => Promise<Response>;
  readonly refresh: (request: Request) => Promise<Response>;
  readonly me: (request: Request) => Promise<Response>;
  readonly sessions: (request: Request) => Promise<Response>;
  readonly revokeSession: (request: Request, sessionId: string) => Promise<Response>;
  readonly revokeOtherSessions: (request: Request) => Promise<Response>;
}

function unavailable(): Promise<Response> {
  return Promise.resolve(
    Response.json(
      { error: "Session service is unavailable." },
      {
        status: 501,
        headers: {
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      },
    ),
  );
}

export function createSessionBffHandlers(
  _dependencies: SessionBffDependencies,
): SessionBffHandlers {
  return {
    sessionCsrf: unavailable,
    login: unavailable,
    logout: unavailable,
    refresh: unavailable,
    me: unavailable,
    sessions: unavailable,
    revokeSession: unavailable,
    revokeOtherSessions: unavailable,
  };
}
