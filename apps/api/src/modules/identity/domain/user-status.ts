export const USER_STATUSES = [
  "pending_activation",
  "active",
  "suspended",
  "disabled",
] as const;

export type UserStatus = (typeof USER_STATUSES)[number];
