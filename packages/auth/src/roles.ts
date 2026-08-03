export const ROLES = {
  platformAdmin: "platform-admin",
  tenantAdmin: "tenant-admin",
  partner: "partner",
  affiliate: "affiliate",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];
