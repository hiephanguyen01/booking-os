import assert from "node:assert/strict";
import test from "node:test";

import { PrismaInvitationRepositoryAdapter } from "./prisma-invitation-repository.adapter.js";
import { PrismaMembershipRepositoryAdapter } from "./prisma-membership-repository.adapter.js";
import { PrismaTenantOutboxAdapter } from "./prisma-tenant-outbox.adapter.js";
import { PrismaTenantProvisioningRepositoryAdapter } from "./prisma-tenant-provisioning-repository.adapter.js";
import { PrismaTenantRoleAssignmentRepositoryAdapter } from "./prisma-tenant-role-assignment-repository.adapter.js";
import { PrismaTenantSecurityAuditAdapter } from "./prisma-tenant-security-audit.adapter.js";

const tenantId = "550e8400-e29b-41d4-a716-446655440001";
const membershipId = "550e8400-e29b-41d4-a716-446655440002";
const invitationId = "550e8400-e29b-41d4-a716-446655440003";
const userId = "550e8400-e29b-41d4-a716-446655440004";
const now = new Date("2026-08-07T03:00:00.000Z");

interface RecordedQuery {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class RecordingTransaction {
  readonly queries: RecordedQuery[] = [];
  readonly executions: RecordedQuery[] = [];
  readonly results: unknown[][] = [];

  async $queryRawUnsafe<T>(sql: string, ...values: unknown[]): Promise<T> {
    this.queries.push({ sql, values });
    return (this.results.shift() ?? []) as T;
  }

  async $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number> {
    this.executions.push({ sql, values });
    return 1;
  }
}

function membershipRow() {
  return {
    id: membershipId,
    tenantId,
    userId,
    status: "active",
    authorizationVersion: 3,
    acceptedAt: now,
    suspendedAt: null,
    revokedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

test("membership and invitation reads are bound to the constructed tenant", async () => {
  const transaction = new RecordingTransaction();
  transaction.results.push([membershipRow()]);
  transaction.results.push([
    {
      id: invitationId,
      tenantId,
      normalizedEmail: "owner@example.test",
      invitedUserId: userId,
      intendedRoleKey: "tenant_owner",
      status: "pending",
      hostname: "acme.example.test",
      selector: "selector",
      tokenHash: "a".repeat(64),
      expiresAt: new Date("2026-08-08T03:00:00.000Z"),
      acceptedAt: null,
      revokedAt: null,
      invitedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    },
  ]);

  const memberships = new PrismaMembershipRepositoryAdapter(transaction, tenantId);
  const invitations = new PrismaInvitationRepositoryAdapter(transaction, tenantId);

  const membership = await memberships.findByUserId(userId);
  const invitation = await invitations.findPendingByEmailAndRole(
    "owner@example.test",
    "tenant_owner",
  );

  assert.equal(membership?.tenantId, tenantId);
  assert.equal(invitation?.tenantId, tenantId);
  assert.deepEqual(transaction.queries[0]?.values, [tenantId, userId]);
  assert.deepEqual(transaction.queries[1]?.values, [
    tenantId,
    "owner@example.test",
    "tenant_owner",
  ]);
  assert.match(transaction.queries[0]?.sql ?? "", /tenant_id/);
  assert.match(transaction.queries[1]?.sql ?? "", /tenant_id/);
});

test("row locks and authorization changes stay inside one tenant", async () => {
  const transaction = new RecordingTransaction();
  transaction.results.push([membershipRow()]);
  transaction.results.push([{ authorizationVersion: 4 }]);
  transaction.results.push([{ userId }]);
  transaction.results.push([{ id: tenantId, slug: "acme", name: "Acme", status: "provisioning" }]);

  const memberships = new PrismaMembershipRepositoryAdapter(transaction, tenantId);
  const roles = new PrismaTenantRoleAssignmentRepositoryAdapter(transaction, tenantId);
  const tenants = new PrismaTenantProvisioningRepositoryAdapter(transaction, tenantId);

  await memberships.lockById(membershipId);
  const version = await memberships.incrementAuthorizationVersion(membershipId, now);
  const owners = await roles.lockActiveOwnerUserIds();
  const tenant = await tenants.lockCurrent();

  assert.equal(version, 4);
  assert.deepEqual(owners, [userId]);
  assert.equal(tenant?.id, tenantId);
  for (const query of transaction.queries) {
    assert.equal(query.values[0], tenantId);
  }
  assert.equal(transaction.queries.filter((query) => /FOR UPDATE/i.test(query.sql)).length, 3);
});

test("role assignment, tenant activation, and audit append never accept a foreign tenant", async () => {
  const transaction = new RecordingTransaction();
  const roles = new PrismaTenantRoleAssignmentRepositoryAdapter(transaction, tenantId);
  const tenants = new PrismaTenantProvisioningRepositoryAdapter(transaction, tenantId);
  const audit = new PrismaTenantSecurityAuditAdapter(transaction, tenantId);

  await roles.assign({ userId, roleKey: "tenant_admin", now });
  await tenants.activate(now);
  await audit.append({
    eventType: "membership.role_assigned",
    actorUserId: userId,
    subjectUserId: userId,
    requestId: "req-1",
    metadata: { roleKey: "tenant_admin" },
    occurredAt: now,
  });

  assert.equal(transaction.executions.length, 3);
  for (const execution of transaction.executions) {
    assert.ok(execution.values.includes(tenantId));
  }
  assert.match(transaction.executions[0]?.sql ?? "", /role_assignments/);
  assert.match(transaction.executions[1]?.sql ?? "", /UPDATE "tenants"/);
  assert.match(transaction.executions[2]?.sql ?? "", /tenant_security_audit_events/);
});

test("tenant outbox append is bound to the constructed tenant", async () => {
  const transaction = new RecordingTransaction();
  const outbox = new PrismaTenantOutboxAdapter(transaction, tenantId);
  const eventId = "550e8400-e29b-41d4-a716-446655440005";

  await outbox.append({
    id: eventId,
    type: "membership.owner_invitation.requested.v1",
    aggregateType: "membership_invitation",
    aggregateId: invitationId,
    payload: {
      version: 1,
      recipient: "owner@example.test",
      hostname: "acme.example.test",
    },
    occurredAt: now,
  });

  assert.equal(transaction.executions.length, 1);
  assert.match(transaction.executions[0]?.sql ?? "", /outbox_events/);
  assert.ok(transaction.executions[0]?.values.includes(eventId));
  assert.ok(transaction.executions[0]?.values.includes(tenantId));
  assert.ok(transaction.executions[0]?.values.includes("membership.owner_invitation.requested.v1"));
  assert.ok(transaction.executions[0]?.values.includes(invitationId));
});
