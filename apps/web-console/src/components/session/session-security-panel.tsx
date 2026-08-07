"use client";

import { useCallback, useEffect, useState } from "react";

type SessionScope = { type: "platform" } | { type: "tenant"; tenantId: string };

type SessionState = "active" | "rotated" | "revoked" | "compromised" | "expired";

interface CurrentAuthentication {
  actor: { id: string };
  session: {
    id: string;
    scope: SessionScope;
    state: SessionState;
  };
}

interface SessionSummary {
  id: string;
  scope: SessionScope;
  hostname: string;
  state: SessionState;
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

interface SessionList {
  sessions: SessionSummary[];
}

export interface SessionSecurityPanelProps {
  onSignedOut?: () => void;
}

const LOAD_ERROR = "We couldn't load your sessions. Try again.";
const UPDATE_ERROR = "We couldn't update your sessions. Try again.";

const REQUEST_OPTIONS = {
  cache: "no-store" as const,
  credentials: "same-origin" as const,
};

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, REQUEST_OPTIONS);
  if (!response.ok) {
    throw new Error("Session request failed");
  }

  return response.json() as Promise<T>;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

export function SessionSecurityPanel({ onSignedOut }: SessionSecurityPanelProps) {
  const [authentication, setAuthentication] = useState<CurrentAuthentication | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setError(null);

    try {
      const [nextAuthentication, nextSessionList] = await Promise.all([
        readJson<CurrentAuthentication>("/api/auth/me"),
        readJson<SessionList>("/api/auth/sessions"),
      ]);

      setAuthentication(nextAuthentication);
      setSessions(nextSessionList.sessions);
    } catch {
      setAuthentication(null);
      setSessions([]);
      setError(LOAD_ERROR);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const runMutation = useCallback(
    async (action: string, url: string, method: "POST" | "DELETE", signedOut = false) => {
      setBusyAction(action);
      setError(null);

      try {
        const response = await fetch(url, {
          ...REQUEST_OPTIONS,
          method,
        });

        if (!response.ok) {
          throw new Error("Session mutation failed");
        }

        if (signedOut) {
          if (onSignedOut) {
            onSignedOut();
          } else {
            window.location.assign("/login");
          }
          return;
        }

        await loadSessions();
      } catch {
        setError(UPDATE_ERROR);
      } finally {
        setBusyAction(null);
      }
    },
    [loadSessions, onSignedOut],
  );

  return (
    <section aria-labelledby="session-security-title">
      <header>
        <p>Account security</p>
        <h1 id="session-security-title">Sessions and devices</h1>
        <p>Review where your account is signed in and revoke access you no longer recognize.</p>
      </header>

      {error ? <p role="alert">{error}</p> : null}

      <section aria-labelledby="current-identity-title">
        <h2 id="current-identity-title">Current identity</h2>
        {authentication ? (
          <dl>
            <div>
              <dt>Actor ID</dt>
              <dd>{authentication.actor.id}</dd>
            </div>
            <div>
              <dt>Session state</dt>
              <dd>{authentication.session.state}</dd>
            </div>
          </dl>
        ) : (
          <p>Loading identity…</p>
        )}
      </section>

      <div>
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => void runMutation("refresh", "/api/auth/session/refresh", "POST")}
        >
          Refresh session
        </button>
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() =>
            void runMutation("revoke-others", "/api/auth/sessions/revoke-others", "POST")
          }
        >
          Revoke other sessions
        </button>
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => void runMutation("logout", "/api/auth/logout", "POST", true)}
        >
          Sign out
        </button>
      </div>

      <section aria-labelledby="device-sessions-title">
        <h2 id="device-sessions-title">Device sessions</h2>
        {sessions.length === 0 ? (
          <p>{error ? "No sessions available." : "Loading sessions…"}</p>
        ) : (
          <ul>
            {sessions.map((session) => (
              <li key={session.id} aria-label={`Session on ${session.hostname}`}>
                <h3>{session.hostname}</h3>
                {session.current ? <p>Current session</p> : null}
                <dl>
                  <div>
                    <dt>State</dt>
                    <dd>{session.state}</dd>
                  </div>
                  <div>
                    <dt>Last active</dt>
                    <dd>{formatDateTime(session.lastSeenAt)}</dd>
                  </div>
                  <div>
                    <dt>Idle expiry</dt>
                    <dd>{formatDateTime(session.idleExpiresAt)}</dd>
                  </div>
                  <div>
                    <dt>Absolute expiry</dt>
                    <dd>{formatDateTime(session.absoluteExpiresAt)}</dd>
                  </div>
                </dl>
                {!session.current ? (
                  <button
                    type="button"
                    disabled={busyAction !== null}
                    onClick={() =>
                      void runMutation(
                        `revoke-${session.id}`,
                        `/api/auth/sessions/${encodeURIComponent(session.id)}`,
                        "DELETE",
                      )
                    }
                  >
                    Revoke session
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}
