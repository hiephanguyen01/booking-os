# Sprint 3 Registration Atomicity Addendum

> **For agentic workers:** REQUIRED SUB-SKILL: Read this after `2026-08-22-sprint-3-00-execution-index.md` and before Plan 3.1. This addendum is mandatory and overrides any Plan 3.2 wording that could be read as allowing an independently committed identity/membership transaction.

## Atomic boundary

Verified Partner establishment has one database commit boundary. The following state must either all commit or all roll back:

```text
registration challenge consumption/completion
+ canonical User create/activation when required
+ PasswordCredential create when required
+ active same-tenant TenantMembership ensure/create
+ Partner create
+ PartnerMembership create
+ partner_owner PartnerSystemRoleAssignment create
+ required status history
+ required security/business audit
+ required outbox records
```

A Partner registration service must **not** call an identity/membership service that opens and commits its own independent transaction before Partner creation.

## Transaction-bound cross-module contract

Keep hexagonal ownership while sharing the transaction. Define an application-facing registration participant capability, owned by the identity/membership boundary, and bind its implementation to the same transaction client/session used by the Partner establishment transaction.

Canonical shape:

```ts
export interface PartnerRegistrationIdentityParticipantPort {
  resolveOrCreateVerifiedIdentity(input: {
    normalizedEmail: string;
    displayEmail: string;
    password?: string;
  }): Promise<{
    userId: string;
    userAuthorizationVersion: number;
    wasUserCreatedOrActivated: boolean;
  }>;

  ensureActiveTenantMembership(input: {
    tenantId: string;
    userId: string;
  }): Promise<{
    tenantMembershipId: string;
    tenantMembershipAuthorizationVersion: number;
    wasCreated: boolean;
  }>;
}
```

The Partner application layer consumes only this port. The composition root/session factory supplies a transaction-bound adapter after the canonical tenant database transaction is open. Do not import identity/membership Prisma adapters into Partner application/domain code.

If existing repository architecture makes a single shared transaction impossible without violating ADR-0007, stop execution at that RED test and write a small ADR/amendment before production code. Do not weaken atomicity by silently using two transactions.

## TenantMembership security behavior

`ensureActiveTenantMembership()` is deliberately narrower than normal tenant onboarding:

- active same-tenant membership -> reuse;
- absent membership -> create `active` membership;
- suspended/revoked membership -> reject registration establishment;
- no `tenant_owner`, `tenant_admin`, or tenant custom-role assignment is created;
- Partner authority is granted only through the new PartnerMembership + `partner_owner` Partner system-role assignment.

This prevents public Partner registration from becoming an unintended Tenant-admin provisioning path.

## RED evidence required before implementation

Add a PostgreSQL integration test that injects a failure after each establishment stage and proves no earlier stage remains committed. At minimum cover failure after:

```text
User/credential creation
TenantMembership creation
Partner creation
PartnerMembership creation
partner_owner assignment
```

After each forced failure, assert the challenge is still unconsumed and no orphan Partner/PartnerMembership/Partner role assignment remains. For newly created identities, assert the new User/credential/TenantMembership also rolled back.

Add a success case proving all rows are visible after one commit and the Partner session is issued only after that commit.

## Execution gate

Plan 3.2 Task 3 is not GREEN until this atomicity integration suite passes against PostgreSQL and architecture verification still proves Partner application/domain code does not import identity/membership infrastructure.
