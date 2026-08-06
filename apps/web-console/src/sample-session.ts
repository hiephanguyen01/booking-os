import { ROLES, type Role } from "@booking-os/auth";

export interface SampleConsoleUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
}

export interface SampleConsoleSession {
  readonly user: SampleConsoleUser;
  readonly expiresAt: string;
}

export const samplePartnerSession: SampleConsoleSession = {
  user: {
    id: "partner-demo",
    email: "partner@example.com",
    displayName: "Partner Demo",
    role: ROLES.partner,
  },
  expiresAt: "2099-01-01T00:00:00.000Z",
};
