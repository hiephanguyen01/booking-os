import {
  ROLES,
  type Role,
  type Session,
} from "@booking-os/auth";

export interface SessionFixtureOverrides {
  readonly id?: string;
  readonly email?: string;
  readonly displayName?: string;
  readonly role?: Role;
  readonly expiresAt?: string;
}

export function createSessionFixture(
  overrides: SessionFixtureOverrides = {},
): Session {
  return {
    user: {
      id: overrides.id ?? "user-1",
      email: overrides.email ?? "partner@example.com",
      displayName: overrides.displayName ?? "Partner User",
      role: overrides.role ?? ROLES.partner,
    },
    expiresAt: overrides.expiresAt ?? "2026-08-04T12:00:00.000Z",
  };
}
