import type { UserStatus } from "./user-status.js";

export type IdentityScopeType = "platform" | "tenant";

export interface GlobalUser {
  readonly id: string;
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly status: UserStatus;
  readonly authorizationVersion: number;
  readonly activatedAt: Date | null;
  readonly suspendedAt: Date | null;
  readonly disabledAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}
