import type { Role } from "./roles.js";

export interface AuthUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
}

export interface Session {
  readonly user: AuthUser;
  readonly expiresAt: string;
}
