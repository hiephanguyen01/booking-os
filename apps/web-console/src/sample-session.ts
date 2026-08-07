import { SYSTEM_ROLES, type SystemRole } from "@booking-os/auth";

export interface SampleConsoleUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: SystemRole;
}

export interface SampleConsoleSession {
  readonly user: SampleConsoleUser;
  readonly expiresAt: string;
}

export const sampleTenantAdminSession: SampleConsoleSession = {
  user: {
    id: "tenant-admin-demo",
    email: "tenant-admin@booking-os.local",
    displayName: "Tenant Admin Demo",
    role: SYSTEM_ROLES.tenantAdmin,
  },
  expiresAt: "2099-01-01T00:00:00.000Z",
};
