import type { TenantMembership } from "../../domain/tenant-membership.js";

export interface CreateInvitedMembershipInput {
  readonly userId: string;
  readonly now: Date;
}

export interface MembershipRepositoryPort {
  list(): Promise<readonly TenantMembership[]>;
  findById(id: string): Promise<TenantMembership | null>;
  findByUserId(userId: string): Promise<TenantMembership | null>;
  lockById(id: string): Promise<TenantMembership | null>;
  createInvited(input: CreateInvitedMembershipInput): Promise<TenantMembership>;
  activate(id: string, now: Date): Promise<TenantMembership>;
  suspend(id: string, now: Date): Promise<TenantMembership>;
  revoke(id: string, now: Date): Promise<TenantMembership>;
  incrementAuthorizationVersion(id: string, now: Date): Promise<number>;
}
