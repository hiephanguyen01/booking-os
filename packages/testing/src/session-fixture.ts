import type { PublicSession, PublicSessionState, SessionScope } from "@booking-os/auth";

export interface SessionFixtureOverrides {
  readonly id?: string;
  readonly userId?: string;
  readonly scope?: SessionScope;
  readonly hostname?: string;
  readonly authorizationVersion?: number;
  readonly state?: PublicSessionState;
  readonly idleExpiresAt?: string;
  readonly absoluteExpiresAt?: string;
}

export function createSessionFixture(overrides: SessionFixtureOverrides = {}): PublicSession {
  return {
    id: overrides.id ?? "session-1",
    userId: overrides.userId ?? "user-1",
    scope: overrides.scope
      ? structuredClone(overrides.scope)
      : { type: "tenant", tenantId: "tenant-1" },
    hostname: overrides.hostname ?? "partner.example.test",
    authorizationVersion: overrides.authorizationVersion ?? 1,
    state: overrides.state ?? "active",
    idleExpiresAt: overrides.idleExpiresAt ?? "2026-08-11T12:00:00.000Z",
    absoluteExpiresAt: overrides.absoluteExpiresAt ?? "2026-09-03T12:00:00.000Z",
  };
}
