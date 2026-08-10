# Sprint 1B Identity, Membership, and Authorization Core Design

Date: 2026-08-05
Status: Approved design — implementation in progress
Owner: identity-access
Depends on: `2026-08-05-tenant-isolation-core-design.md`
Amendment: `../../spec-amendments/2026-08-10-master-spec-v4-identity-authorization-amendment.md`

## Summary

Sprint 1B adds the first production-grade identity and access-control vertical slice to Booking OS. It keeps the product as a modular monolith and implements authentication, tenant membership, fixed system roles, backend-authoritative authorization, and minimal platform provisioning inside the existing NestJS API and Next.js BFF boundaries.

The design uses one global user per normalized email, admin-provisioned accounts, one-time activation and invitation links, Argon2id password credentials, opaque server-side sessions, host-only cookies, and separate sessions for every hostname and device. Tenant requests remain anchored to the trusted hostname resolver from Sprint 1A and execute tenant-owned work through the existing RLS transaction boundary.

Sprint 1B supports only platform and tenant scopes. It seeds `platform_admin`, `tenant_owner`, and `tenant_admin` as immutable system roles. Partner and affiliate scopes, custom roles, subscription entitlements, self-registration, social login, SSO, and complete MFA are deferred from this Sprint 1B administrative slice. Actor-specific Customer/Partner authentication and the dynamic-RBAC transition are governed by the dated amendment above and the 90-day roadmap.

## Approved Product Decisions

The following decisions were approved during design review:

1. Accounts are admin-provisioned; public self-registration is disabled for the Sprint 1B Platform/Tenant administrative slice.
2. New administrative users set their password through a one-time activation link.
3. Browser authentication uses opaque server-side sessions rather than browser-held JWTs.
4. Multiple concurrent device sessions are allowed and independently revocable.
5. Sessions expire after seven days of inactivity and no later than 30 days after creation.
6. Activation links expire after 24 hours; resending invalidates prior links.
7. Passwords require at least 12 characters, use Argon2id, and are checked against common or breached-password data without traditional composition rules.
8. Login abuse protection uses progressive delay and rate limits keyed by both account identifier and network source; accounts are not hard-locked by failed attempts.
9. Sprint 1B supports platform and tenant authorization scopes only.
10. Sprint 1B exposes immutable system roles only; tenant-defined roles are deferred to the explicit dynamic-RBAC transition.
11. A platform admin provisions a tenant owner. Tenant owners and tenant admins may invite users within their tenant, subject to grant restrictions.
12. An existing global user is reused when invited to another tenant.
13. Sessions are host-only and are never shared across tenant subdomains.
14. An invited existing user must authenticate and explicitly accept the invitation. Invitation tokens do not create a session.
15. Password-reset links are single-use, expire after 30 minutes, and revoke all sessions after successful reset for the Sprint 1B administrative flows.

The 2026-08-10 amendment is authoritative where later approved product decisions supersede exact permission-key examples, Customer authentication delivery, dynamic-RBAC timing, or actor-scope interpretation in this historical design.

## Baseline State at Design Approval — 2026-08-05

Sprint 1A provides:

- strict tenant resolution from an exact configured base domain;
- trusted proxy handling for the effective hostname;
- immutable request and tenant execution context;
- a technology-neutral tenant transaction port;
- transaction-local `booking_app` role and tenant context;
- FORCE RLS for tenant-owned tables;
- dependency-direction checks for Hexagonal API module boundaries;
- safe worker privilege and infrastructure event paths.

At design approval, the application did not provide:

- a global user model;
- password credentials or account activation;
- persistent browser sessions;
- tenant memberships;
- roles, permissions, or policy guards;
- a platform control-plane session;
- user invitations or password reset;
- an authorization-context endpoint.

Sprint 1B must build on the Sprint 1A boundary rather than introduce tenant IDs from request bodies, query parameters, arbitrary headers, or browser-managed access tokens.

## Implementation Status — reconciled 2026-08-10

Reconciled with `main` at `81f0a191abdc475ff1ce2c502a45daf78d9352b6` and `docs/superpowers/checkpoints/2026-08-10-sprint-1b-reconciliation.md`.

- Plans 1B.1–1B.3 have implementation in the repository for identity foundation, opaque sessions, membership/provisioning, and related administrative flows.
- Plan 1B.4 Task 1 is implemented by `ac5433dfbc272db4eb397269ba23f23926fbdb4b` (`feat: build authoritative authorization context`).
- Plan 1B.4 Task 2 is implemented by `545d77111dc40dd9a99209c7b9ce5b5d6ea77184` (`feat: enforce permission and resource policies`).
- Plan 1B.4 Task 3 is **in progress**. `c9a11c7bea153b6f16ea1ab6b738596dbac9740f` adds authorization session snapshots, membership authorization versioning, rejection of attacker-controlled identity/role/permission/version headers, and stale-authority reconciliation/rotation. Task 3 is not complete until its planned before-use-case/concurrency E2E evidence and closeout are verified.
- Plan 1B.4 Tasks 4–8 are pending and therefore `EXPECTED_INCOMPLETE`; their absent outputs must not be reported as conflicts or missing implementation while Task 3 is active.
- The implemented Permission Catalog V2 naming direction, Customer six-digit Email OTP initial delivery, actor-auth scope bridge, and dynamic-RBAC bridge are recorded in the dated amendment and supersede conflicting historical examples in this document.

## Goals

1. Establish one global identity per normalized email across all tenants.
2. Provision the first platform administrator without exposing a permanent bootstrap HTTP endpoint.
3. Let a platform administrator create a tenant and invite its first owner.
4. Let a tenant owner or tenant administrator invite additional tenant administrators within safe grant boundaries.
5. Activate new accounts with single-use, time-limited links.
6. Authenticate users with Argon2id credentials and enumeration-safe responses.
7. Issue opaque, host-only, independently revocable sessions for platform and tenant scopes.
8. Support restricted invitation-pending sessions so an existing user can authenticate before accepting a new tenant membership.
9. Enforce backend permissions, membership state, scope matching, ownership rules, and tenant RLS on every protected request.
10. Invalidate stale authorization through user and membership authorization versions.
11. Implement password reset, session inventory, per-session revocation, and global sign-out.
12. Provide security audit events and metrics without logging credentials, raw tokens, or sensitive personal data.
13. Add OpenAPI contracts and automated security tests for the full vertical slice.

## Non-goals

These are non-goals for the **Sprint 1B Platform/Tenant administrative slice**, not permanent product exclusions. Later actor/product delivery follows the Master Spec plus the 2026-08-10 amendment.

- Public self-registration inside Sprint 1B. Customer self-registration is delivered later using six-digit Email OTP initially.
- Social login, passkeys, OIDC, SAML, or enterprise SSO. Social controls remain hidden until a provider flow is explicitly delivered.
- Shared cookies or central SSO across tenant hostnames.
- Partner or affiliate scope. Partner scope arrives with Partner delivery and reuses the shared auth kernel.
- Tenant-defined roles or permission editing. Tenant dynamic RBAC is a Sprint 2 transition over code-seeded Permission Catalog V2.
- Subscription, plan, or entitlement enforcement.
- Product-domain permissions for listings, bookings, payments, finance, or settlements.
- Complete MFA or step-up authentication flows.
- Account recovery through support agents.
- A complete tenant onboarding wizard or member-management product experience.
- Splitting identity into a separately deployed service.
- Browser-visible access or refresh JWTs.

## Architecture Decision

Sprint 1B uses an auth kernel inside the existing modular monolith. Identity, sessions, memberships, and authorization are separate modules with explicit ports, use cases, adapters, and composition roots.

```text
apps/api/src/modules/
├── identity/
│   ├── domain/
│   ├── application/
│   │   ├── ports/
│   │   └── use-cases/
│   ├── infrastructure/
│   │   ├── crypto/
│   │   ├── email/
│   │   ├── http/
│   │   └── persistence/
│   ├── identity.tokens.ts
│   └── identity.module.ts
├── sessions/
│   ├── domain/
│   ├── application/
│   │   ├── ports/
│   │   └── use-cases/
│   ├── infrastructure/
│   │   ├── http/
│   │   └── persistence/
│   ├── sessions.tokens.ts
│   └── sessions.module.ts
├── memberships/
│   ├── domain/
│   ├── application/
│   │   ├── ports/
│   │   └── use-cases/
│   ├── infrastructure/
│   │   ├── http/
│   │   └── persistence/
│   ├── memberships.tokens.ts
│   └── memberships.module.ts
└── authorization/
    ├── domain/
    ├── application/
    │   ├── ports/
    │   └── use-cases/
    ├── infrastructure/http/
    ├── authorization.tokens.ts
    └── authorization.module.ts
```

The dependency direction is:

```text
HTTP, Prisma, crypto, email adapters
    -> application use cases and ports
        -> domain

NestJS modules -> composition and adapter binding only
```

### Module responsibilities

`IdentityModule` owns global users, normalized email identity, password credentials, activation, password reset, password policy, and security-state changes.

`SessionsModule` owns opaque session families, token rotation, idle and absolute expiry, cookie issuance, session inventory, revocation, and authentication context.

`MembershipsModule` owns tenant invitations, membership state, system-role assignments, owner safety, and tenant provisioning handoff.

`AuthorizationModule` converts authenticated context into permissions and applies permission and resource-policy guards. It is the only module that answers whether an authenticated actor may perform a protected operation.

`TenancyModule` remains responsible only for trusted hostname-to-tenant resolution and tenant execution. It does not validate credentials and does not grant permissions.

### Dependency rules

- Domain code imports no NestJS, Prisma, HTTP, cookie, Redis, queue, logger, environment, or email-provider code.
- Application ports expose no Prisma, Express, Fastify, BullMQ, Redis, or provider-specific types.
- Controllers and guards invoke use cases rather than querying Prisma directly.
- Identity code cannot import tenancy infrastructure.
- Membership and authorization adapters may call the public tenancy application contracts but never its infrastructure directory.
- No product module may inspect role names directly. Product modules require permission slugs or resource-policy decisions.
- The browser never calls database or identity-provider adapters directly.

## Security Invariants

The following invariants are mandatory and must be backed by automated tests:

1. Tenant identity originates only from the trusted effective hostname resolver.
2. A tenant session is valid only on the exact hostname and tenant for which it was issued.
3. Cookies use the `__Host-` prefix, `Secure`, `HttpOnly`, `Path=/`, `SameSite=Lax`, and no `Domain` attribute.
4. Raw activation, invitation, reset, OTP, and session secrets are never stored in application-visible database columns or logs.
5. One-time tokens/challenges are single-use, time-limited, purpose-bound, and hostname/scope-bound where applicable.
6. Password reset revokes every platform and tenant session for the user according to the shared security policy.
7. A user cannot grant a role or permission they are not allowed to grant.
8. Tenant endpoints cannot create or assign `platform_admin`.
9. A tenant cannot lose its final active owner while the tenant is active.
10. Tenant-owned membership, invitation, role-assignment, and tenant-session rows are protected by FORCE RLS.
11. Platform operations that mutate tenant-owned data enter one explicit tenant transaction at a time.
12. A stale, suspended, revoked, or scope-mismatched session never reaches product application logic.
13. Generic login, activation-resend, invitation, reset, and verification responses do not reveal whether an email exists globally.
14. Authentication and authorization responses are never stored in shared caches.
15. Unsafe browser requests require both a same-origin check and a valid session-bound CSRF token.

## Host and Scope Model

### Tenant scope

Tenant traffic uses the exact pattern already enforced by Sprint 1A:

```text
<tenant-slug>.<TENANT_BASE_DOMAIN>
```

The tenant is resolved before credential validation. A session created on one tenant hostname cannot be replayed on another tenant hostname, even when the same global user belongs to both tenants.

### Platform scope

Platform administration uses one exact configured hostname:

```text
PLATFORM_HOSTNAME
```

The hostname must be outside the tenant-slug namespace or must be explicitly reserved. The selected platform label cannot be registered as a tenant slug.

Platform routes require all of the following:

- the exact platform hostname;
- a valid platform session issued for that hostname;
- an active global user;
- an active `platform_admin` assignment;
- the required platform permission.

A platform session cannot authorize a tenant route. A tenant session cannot authorize a platform route.

### Browser and BFF boundary

The browser communicates with the same-origin Next.js application/BFF. The BFF forwards the original trusted host through the configured proxy path. The API continues to enforce base-domain and trusted-proxy rules and never accepts `x-tenant-id`, request-body tenant IDs, or query-string tenant IDs as authorization context.

Browser JavaScript never reads the session cookie. Browser-visible authentication state comes from same-origin endpoints such as `/auth/me` and `/auth/me/authorization` with `Cache-Control: private, no-store`.

## Domain Model

### Global identity

`User`

- `id`
- `normalizedEmail` — unique, case-folded, trimmed, and canonicalized according to one documented normalization function
- `displayEmail` — original display form
- `status` — `pending_activation | active | suspended | disabled`
- `authorizationVersion`
- `activatedAt`
- `lastPasswordChangedAt`
- `createdAt`
- `updatedAt`

The normalization function must not perform provider-specific transformations such as removing dots or plus tags. One normalized email maps to exactly one global user.

`PasswordCredential`

- `userId` — unique
- `passwordHash`
- `algorithm` — `argon2id`
- `parameters`
- `createdAt`
- `updatedAt`

Password hashes are rehashed after successful login when stored parameters fall below the current policy.

### One-time identity tokens

`AccountActivationToken`

- `id`
- `userId`
- `scopeType` — `platform | tenant`
- `tenantId` — required for tenant scope and null for platform scope
- `invitationId` — required for tenant invitation activation and null for platform bootstrap
- `hostname`
- `tokenHash`
- `expiresAt`
- `consumedAt`
- `revokedAt`
- `createdAt`

`PasswordResetToken`

- `id`
- `userId`
- `scopeType` — `platform | tenant`
- `tenantId` — required for tenant scope
- `hostname`
- `tokenHash`
- `expiresAt`
- `consumedAt`
- `revokedAt`
- `createdAt`

Only a cryptographic hash or keyed hash of the raw token is stored. Token comparison is constant-time after selector lookup. Resending or reissuing revokes all prior active tokens for the same purpose and user/scope.

Customer six-digit Email OTP challenges are a later actor-specific extension over the same identity/security kernel. Their channel-independent challenge model and initial Email delivery are specified by the 2026-08-10 amendment; they do not replace Sprint 1B administrative activation links.

### Tenant membership

`TenantMembership`

- `id`
- `tenantId`
- `userId`
- `status` — `invited | active | suspended | revoked`
- `authorizationVersion`
- `acceptedAt`
- `suspendedAt`
- `revokedAt`
- `createdAt`
- `updatedAt`

Database constraints enforce one membership per `(tenantId, userId)`.

`MembershipInvitation`

- `id`
- `tenantId`
- `normalizedEmail`
- `invitedUserId` — nullable until the global user is resolved or created
- `intendedRoleKey`
- `status` — `pending | accepted | revoked | expired`
- `tokenHash`
- `hostname`
- `expiresAt`
- `emailVerifiedAt`
- `acceptedAt`
- `revokedAt`
- `invitedByUserId`
- `createdAt`

Only one active invitation for the same `(tenantId, normalizedEmail, intendedRoleKey)` is allowed. Resending atomically revokes the previous token and issues a new token.

### Roles and permissions

`Role`

- `id`
- `key`
- `scopeLevel` — `platform | tenant`
- `isSystem`
- `createdAt`

`Permission`

- `id`
- `key`
- `scopeLevel`
- `createdAt`

`RolePermission`

- `roleId`
- `permissionId`

`RoleAssignment`

- `id`
- `userId`
- `roleId`
- `scopeLevel`
- `tenantId` — required for tenant scope and null for platform scope
- `createdAt`
- `revokedAt`

Database checks enforce valid scope shape. Tenant assignments include `tenantId` directly so FORCE RLS does not depend on joins.

The schema supports later dynamic roles, but Sprint 1B exposes no create, update, delete, or permission-editing API for roles. Seeded system roles and permissions are migration-controlled. The explicit transition is Sprint 1B fixed system roles → Sprint 2 tenant dynamic roles → Partner-scoped roles with Partner delivery → Phase 2 full three-level Role Builder UI.

### Sessions

A session family represents one user, device, hostname, and authorization scope. Session tokens rotate within the family.

`AuthSession`

- `id`
- `userId`
- `scopeType` — `platform | tenant`
- `tenantId` — required for tenant scope
- `hostname`
- `state` — `invitation_pending | active | revoked | compromised | expired`
- `userAuthorizationVersion`
- `membershipAuthorizationVersion` — required for tenant active sessions
- `createdAt`
- `lastSeenAt`
- `idleExpiresAt`
- `absoluteExpiresAt`
- `revokedAt`
- `revocationReason`
- `userAgentSummary`
- `networkSummary`

`AuthSessionToken`

- `id` — public selector, random and non-sequential
- `sessionId`
- `tenantId` — copied for tenant RLS
- `tokenHash`
- `issuedAt`
- `expiresAt`
- `replacedAt`
- `replacedByTokenId`
- `reuseDetectedAt`

The browser cookie contains a random selector and secret. The database stores only the selector and a keyed hash of the secret.

Tenant session and token rows are FORCE-RLS protected. Platform session rows are isolated by scope constraints and accessed only from exact platform-host use cases. If a single physical table is used, database policies and grants must make tenant and platform access paths explicit; a generic unscoped session lookup is prohibited.

## Tenant Lifecycle for Initial Owner Provisioning

A tenant created through Sprint 1B starts in `provisioning` state.

1. A platform administrator submits tenant identity, slug, primary hostname, and owner email on the platform hostname.
2. The platform use case validates the platform permission and reserves the tenant slug and hostname.
3. One transaction creates the tenant in `provisioning`, its primary domain, an invited membership, and an owner invitation.
4. If the global user does not exist, the use case also creates a `pending_activation` user and activation token.
5. The email delivery event is committed through the transactional outbox.
6. The owner activates the account if necessary, authenticates on the tenant hostname, and accepts the invitation.
7. The membership becomes active, the owner role is assigned, and the tenant becomes `active` atomically.

A provisioning tenant exposes only health, activation, login, password-reset, invitation-inspection, invitation-acceptance, and logout flows. Product routes remain unavailable until an active owner exists.

## Bootstrap Platform Administrator

The first `platform_admin` is created by an idempotent deployment command or seed operation, not by an HTTP endpoint.

The bootstrap operation:

- accepts an explicitly configured email;
- creates or reuses the global user;
- creates the system platform role assignment while the user remains pending activation;
- issues an activation link through the same one-time-token and email-outbox path;
- records a security audit event;
- refuses to grant a second bootstrap assignment unless an explicit recovery procedure is invoked;
- can be disabled after the first administrator is active.

No long-lived bootstrap secret, default password, or public setup route is permitted.

## Role and Permission Model

### System roles

`platform_admin`

- create and read tenants;
- invite or resend the initial tenant owner;
- inspect tenant provisioning status;
- inspect and revoke user sessions for security response;
- never bypass hostname, session, audit, or target-tenant transaction requirements.

`tenant_owner`

- read tenant membership state;
- invite tenant administrators;
- revoke or suspend tenant administrators;
- promote an active tenant administrator to owner;
- demote an owner only when another active owner remains;
- inspect sessions in the same tenant and revoke tenant-administrator sessions;
- manage later tenant-level settings when those permissions are introduced.

`tenant_admin`

- read tenant membership state;
- invite other tenant administrators;
- revoke or suspend tenant administrators other than themselves when policy permits;
- inspect and revoke tenant-administrator sessions in the same tenant;
- never grant, promote, demote, suspend, or revoke a tenant owner;
- never assign platform roles.

Sprint 1B has no regular tenant-member role. Product-specific member roles will be introduced with the product modules that require them.

### Initial permission catalog — historical design input

The following list was the exact permission-key proposal approved with this design on 2026-08-05. It is preserved for traceability, but **its exact key naming is superseded where it conflicts with** `docs/spec-amendments/2026-08-10-master-spec-v4-identity-authorization-amendment.md`. The code-seeded Permission Catalog V2 is canonical for capabilities already implemented.

```text
platform.tenant.create
platform.tenant.read
platform.tenant.owner.invite
platform.tenant.owner.resend
platform.security.session.revoke

tenant.membership.read
tenant.membership.admin.invite
tenant.membership.admin.suspend
tenant.membership.admin.revoke
tenant.membership.owner.promote
tenant.membership.owner.demote
tenant.security.session.read
tenant.security.session.revoke
```

Permission keys remain append-only identifiers. Renaming or removing an issued permission requires an explicit migration and compatibility plan. The amendment changes the canonical exact names for implemented capabilities; it does not weaken this append-only rule.

### Grant rules

Permission possession alone is not sufficient for role assignment. A separate grant policy enforces:

- platform admins may issue the initial owner invitation but cannot create an active membership without acceptance;
- tenant owners may grant `tenant_admin` and promote an active tenant admin to `tenant_owner`;
- tenant admins may grant only `tenant_admin`;
- no tenant actor may grant `platform_admin`;
- no actor may use a tenant endpoint to alter another tenant;
- no operation may remove or demote the final active tenant owner.

The final-owner invariant is enforced inside one tenant transaction with row or advisory locking. A deferred database constraint trigger or equivalent database-level invariant must reject a commit that leaves an active tenant without an active owner.

## Account Provisioning and Activation

### New user invitation

1. An authorized admin submits an email and allowed intended role.
2. The API normalizes the email and applies grant policy.
3. The response is neutral about whether the email already exists globally.
4. If no global user exists, the transaction creates a `pending_activation` user, invited membership, role intent, invitation, and activation token.
5. The raw activation token is delivered only through the secure email envelope path.
6. The activation link is valid for 24 hours and is bound to the exact hostname, user, invitation, and `activate_account` purpose.
7. The user opens the link, sets a compliant password, and consumes the activation token.
8. Activation consumes the token and records email-possession verification on the bound invitation. It does not create a session and does not activate the membership.
9. The user signs in normally on the tenant hostname.
10. The user explicitly accepts the verified pending invitation.

### Existing global user invitation

1. The admin receives the same neutral success response.
2. The existing user and credential are reused.
3. A new invited membership and invitation token are created for the target tenant.
4. The invitation link opens on the exact tenant hostname.
5. The token does not authenticate the user and does not create a session.
6. The user signs in with the existing global credential.
7. Because membership is not yet active, the API may create a restricted `invitation_pending` session only when a valid pending invitation exists for the authenticated user and hostname.
8. The restricted session can access only invitation inspection, invitation acceptance, `/auth/me`, CSRF, password reset/change, and logout operations.
9. Acceptance requires the still-valid invitation token for an existing user. For a newly activated user, successful activation records `emailVerifiedAt` on the bound invitation, so the already-consumed activation token supplies the email-possession proof.
10. Acceptance atomically activates membership, creates the allowed role assignment, increments membership authorization version, rotates the session token, and changes the session to `active`.

### Invitation links

Email links place the raw token in a URL fragment where supported:

```text
https://<hostname>/invite/accept#token=<secret>
```

The browser removes the fragment from history immediately and sends the token only in the body of a same-origin POST after authentication. Tokens must never appear in access logs, analytics URLs, referrer headers, or exception messages.

## Password Policy

Passwords:

- contain at least 12 Unicode characters after documented normalization;
- may be passphrases and do not require arbitrary uppercase, lowercase, digit, or symbol combinations;
- are rejected when found in the configured common-password denylist;
- may be checked against a breach corpus only through a privacy-preserving adapter such as offline data or k-anonymity;
- are hashed with Argon2id;
- are never truncated silently;
- are never logged, included in events, or returned in validation detail.

The initial Argon2id policy must define a tested minimum and remain configurable. A suitable baseline is Argon2id version 19 with at least 64 MiB memory, three iterations, and parallelism one, subject to deployment benchmarking. The implementation must support transparent rehash after successful authentication.

Password changes and resets increment the user authorization version. A password reset revokes every session. An authenticated password change may either revoke all other sessions or all sessions according to the final implementation plan, but it must rotate the current session if retained.

Customer password recovery is not defined by this Sprint 1B administrative link flow. Per the dated amendment, the initial Customer flow uses a six-digit Email OTP challenge, then reuses the same credential/session invalidation security invariants.

## Login and Abuse Protection

### Login behavior

A tenant login request succeeds only when:

- the hostname resolves to an active or provisioning tenant;
- the global user is active;
- the password verifies;
- either an active membership exists or a valid pending invitation permits a restricted session;
- abuse controls allow the attempt.

A platform login request additionally requires an active `platform_admin` assignment.

Failure responses use one public error shape such as `INVALID_CREDENTIALS_OR_ACCESS`. Internal audit reason codes may distinguish unknown user, wrong password, disabled user, missing membership, revoked membership, or invalid scope, but those codes are never returned to the unauthenticated client.

### Progressive delay

The abuse-control port evaluates at least:

- a keyed digest of normalized email;
- full or privacy-reduced source IP;
- combined account and source key;
- hostname and route purpose.

Repeated failures increase delay exponentially up to a configured ceiling. Successful authentication decays or clears the relevant counters. There is no attacker-triggerable permanent account lock.

Rate-limit storage must work across application replicas. If the selected shared store is unavailable, the implementation plan must define a security-preserving degraded mode and alert rather than silently disabling protection.

## Opaque Session Protocol

### Cookie

The default cookie is:

```text
__Host-booking_session
```

Required attributes:

```text
Secure; HttpOnly; SameSite=Lax; Path=/
```

The cookie has no `Domain` attribute and is therefore host-only. Production refuses to start when secure-cookie or hostname configuration is invalid.

### Lifetime

- Idle timeout: seven days.
- Absolute lifetime: 30 days from session creation.
- `lastSeenAt` and idle expiry are updated with write coalescing to avoid a database write on every request.
- Activity never extends the absolute expiry.
- Expired or revoked sessions are rejected before authorization context is built.

### Rotation and reuse detection

Opaque session secrets rotate:

- after successful login establishment;
- when an invitation-pending session becomes active;
- after privilege elevation or sensitive credential changes;
- through an explicit refresh operation before the current token reaches its rotation threshold;
- whenever compromise response requires a new secret.

Rotation creates a new token row and marks the old token as replaced. A short, bounded overlap window may accept already in-flight requests using the previous token. Use of a replaced token after the overlap window marks the session family as compromised, revokes it, emits an audit event, and requires reauthentication.

The raw replacement token is returned only through `Set-Cookie`. It is never returned in JSON.

### Multiple devices

Every device/browser session has a separate session family. Users can:

- list their current sessions;
- identify the current session;
- revoke one other session;
- revoke every other session;
- sign out the current session;
- sign out everywhere.

Tenant owners and tenant admins may revoke sessions only according to tenant grant policy. Neither tenant role may revoke another owner session; owners remain removable only through membership policy, and platform incident response may revoke any user session with explicit permission and audit logging.

### Authorization versions

Each session snapshots:

- `User.authorizationVersion`;
- `TenantMembership.authorizationVersion` for tenant scope;
- effective scope and hostname.

Every protected request verifies the current versions before using cached authorization. A version mismatch forces an authoritative rebuild. If the user or membership is no longer active, the session is revoked. If only permissions changed, the session may continue after refreshing the snapshot and rotating its token.

Password reset, user suspension, user disablement, and confirmed session compromise revoke sessions rather than merely updating snapshots.

## CSRF, CORS, and Browser Security

SameSite cookies are defense in depth, not the only CSRF control.

Every unsafe browser request must satisfy:

1. exact allowed `Origin` validation for the current hostname;
2. a valid CSRF token sent in a custom header;
3. normal session, scope, permission, and RLS checks when the route is authenticated.

Authenticated routes use a session-bound synchronizer or double-submit token. Pre-authentication routes such as login, forgot-password, activation, reset, and later Customer OTP verification use a short-lived host-bound pre-authentication CSRF token. The CSRF token is never the session secret or OTP. It may be exposed to same-origin JavaScript through a dedicated endpoint or host-only non-HttpOnly cookie and is validated using constant-time comparison or a keyed derivation.

CORS is deny-by-default. Production allows only configured first-party origins and credentials. Wildcard origins with credentials are prohibited.

Authentication pages set a restrictive Content Security Policy, `Referrer-Policy: no-referrer`, clickjacking protection, and `Cache-Control: no-store`. Token-bearing fragments are removed from browser history before any third-party script executes.

## Authorization Evaluation

For a tenant request:

```text
Resolve exact hostname tenant
-> validate opaque session token under that tenant RLS context
-> verify session hostname and scope
-> load active user
-> load active membership
-> compare authorization versions
-> resolve seeded roles and permissions
-> apply grant or resource policy
-> execute use case inside tenant RLS transaction
```

The general rule is:

```text
Allow =
  authenticated
  AND session_scope_matches
  AND user_is_active
  AND active_membership_when_tenant_scoped
  AND required_permission
  AND grant_or_resource_policy
  AND tenant_RLS_context
```

An `invitation_pending` session is a deliberate exception with an explicit route allowlist. It never satisfies a normal tenant permission guard.

### Authorization context endpoint

`GET /auth/me/authorization` returns a non-sensitive representation:

- user ID and display email;
- session ID and whether it is current;
- scope type;
- tenant ID and slug for tenant scope;
- membership ID and status;
- system role keys;
- effective permission keys;
- user and membership authorization versions.

The endpoint is backend-authoritative, uses `Cache-Control: private, no-store`, and never returns password metadata, token hashes, raw tokens, internal abuse state, or other-tenant memberships.

This endpoint remains a Plan 1B.4 Task 4 deliverable. Its absence while Task 3 is active is `EXPECTED_INCOMPLETE`, not a design/code conflict.

## Minimal API Surface

Exact route naming may be adjusted during implementation planning, but the following capabilities are required for Sprint 1B closeout.

### Public authentication routes on an allowed hostname

```text
POST /auth/login
POST /auth/logout
POST /auth/session/refresh
GET  /auth/csrf
GET  /auth/me
GET  /auth/me/authorization
GET  /auth/sessions
DELETE /auth/sessions/:sessionId
POST /auth/sessions/revoke-others
POST /auth/password/forgot
POST /auth/password/reset
POST /auth/password/change
POST /auth/activation/complete
```

### Invitation and membership routes on a tenant hostname

```text
GET  /membership/invitations/current
POST /membership/invitations/accept
POST /membership/invitations
POST /membership/invitations/:invitationId/resend
GET  /memberships
POST /memberships/:membershipId/suspend
POST /memberships/:membershipId/revoke
POST /memberships/:membershipId/promote-owner
POST /memberships/:membershipId/demote-owner
```

### Platform routes on the exact platform hostname

```text
POST /platform/tenants
GET  /platform/tenants/:tenantId
POST /platform/tenants/:tenantId/owner-invitation/resend
POST /platform/security/users/:userId/sessions/revoke
```

All state-changing routes require CSRF protection for browser traffic, idempotency where retries can duplicate effects, audit events, and explicit authorization policy.

## Minimal User Experience

Sprint 1B requires only the screens needed to exercise the vertical slice:

- platform administrator login;
- minimal create-tenant form with owner email;
- account activation and password creation;
- tenant login;
- invitation review and explicit acceptance;
- forgot-password and reset-password;
- current-session and session-list management;
- minimal tenant membership list and invitation form.

No full onboarding wizard, custom role editor, subscription selector, Customer signup UX, Partner onboarding UX, or product navigation is required by Sprint 1B itself.

## One-Time Token Delivery

The identity transaction stores only token hashes. Reliable email delivery still needs access to the raw one-time token, so the transactional outbox uses a sensitive-payload envelope:

1. The use case generates the raw token in memory.
2. The token record stores only a keyed hash.
3. An encryption port wraps the email-only secret with authenticated encryption before it enters the outbox payload.
4. The worker decrypts the envelope only in memory immediately before provider submission.
5. Structured logs, traces, dead-letter views, and error reports redact the envelope and token.
6. The encrypted delivery payload is deleted or cryptographically expired after successful delivery or terminal failure.

Encryption keys come from deployment secret management and support rotation. Storing raw one-time tokens in plain JSON outbox payloads is prohibited. Later Customer Email OTP delivery must follow equivalent secret-handling, enumeration, rate-limit, expiry, and single-use invariants.

## Audit and Observability

Security audit events include:

```text
identity.user.provisioned
identity.user.activated
identity.password.changed
identity.password.reset_requested
identity.password.reset_completed
identity.user.suspended
session.created
session.rotated
session.revoked
session.reuse_detected
membership.invited
membership.invitation_resent
membership.accepted
membership.suspended
membership.revoked
membership.owner_promoted
membership.owner_demoted
tenant.provisioned
tenant.activated
platform.bootstrap_admin_created
authorization.denied
```

Audit records capture actor ID when known, target ID, tenant ID when applicable, request ID, trusted hostname, action, result, and a stable reason code. They never capture passwords, OTPs, raw tokens, session cookies, full authorization headers, or unredacted email bodies.

Metrics include login success/failure, progressive-delay activation, token issue/consume/expiry, invitation acceptance, session creation/revocation/reuse, authorization denial, and tenant provisioning duration. Metrics must avoid raw email and user IDs as high-cardinality labels.

## Error Model

Public errors use stable codes and safe messages. Representative codes include:

```text
INVALID_CREDENTIALS_OR_ACCESS
ACTIVATION_TOKEN_INVALID_OR_EXPIRED
INVITATION_INVALID_OR_EXPIRED
PASSWORD_RESET_INVALID_OR_EXPIRED
PASSWORD_POLICY_REJECTED
SESSION_REQUIRED
SESSION_EXPIRED
SESSION_REVOKED
SESSION_SCOPE_MISMATCH
SESSION_ROTATED
CSRF_VALIDATION_FAILED
MEMBERSHIP_REQUIRED
MEMBERSHIP_INACTIVE
PERMISSION_DENIED
ROLE_GRANT_NOT_ALLOWED
LAST_TENANT_OWNER
TENANT_NOT_AVAILABLE
RATE_LIMITED
```

Unauthenticated responses do not distinguish unknown email, wrong password, absent membership, or disabled account. Internal reason codes remain available only to audit and observability systems.

## Data Isolation and Database Policy

### Tenant-owned tables

The following rows are tenant-owned and must include `tenant_id`, FORCE RLS, and policy-manifest coverage:

- tenant memberships;
- membership invitations;
- tenant role assignments;
- tenant-scoped auth sessions;
- tenant-scoped session tokens;
- tenant-scoped activation and invitation token records;
- tenant security audit records when stored in a shared audit table.

Queries against these tables execute only inside the tenant transaction port with transaction-local role and tenant context.

### Global identity tables

Global users, password credentials, permission definitions, system role definitions, and platform role assignments are global. Access is restricted through identity or platform application ports. Product modules cannot import their persistence adapters.

### Platform mutations of tenant data

A platform administrator does not receive an unscoped bypass over tenant tables. After platform authorization, the use case resolves one target tenant and enters a standard tenant transaction to create or update tenant-owned rows. Cross-tenant batch operations iterate explicit tenant transactions and produce per-tenant audit records.

### Constraints

Database constraints cover at least:

- unique normalized global email;
- one membership per user and tenant;
- valid scope shape for role assignments and sessions;
- one active session-token successor per token;
- no expired token consumption;
- no duplicate active invitation for the same tenant/email/role intent;
- no active tenant without an active owner at commit;
- tenant ID consistency between sessions and session tokens.

## Transaction Boundaries and Concurrency

Sensitive transitions are atomic:

- tenant provisioning, owner invitation, and email outbox event;
- invitation resend and old-token revocation;
- invitation acceptance, membership activation, role assignment, authorization-version increment, tenant activation when first owner, session elevation, and token rotation;
- password reset, credential replacement, authorization-version increment, token invalidation, all-session revocation, audit event, and notification event;
- owner promotion/demotion and final-owner validation;
- session rotation and replacement-token linkage.

Invitation acceptance and password reset lock the one-time token row before validating consumption state. Role changes lock the membership and affected owner set. Session rotation uses compare-and-set semantics so concurrent refreshes cannot create multiple valid successors.

## Testing Strategy

### Unit tests

- email normalization and uniqueness behavior;
- password policy and Argon2id rehash decisions;
- token generation, hashing, expiry, purpose, and hostname binding;
- role grant policy;
- final-owner policy;
- session expiry and rotation state machine;
- authorization-version reconciliation;
- public error mapping and redaction.

### Database integration tests

- all new migrations apply from an empty database;
- seeded roles and permissions are deterministic and idempotent;
- tenant RLS blocks cross-tenant membership, invitation, role-assignment, and session access;
- missing tenant context fails closed;
- platform use cases mutate tenant rows only through a target tenant context;
- final-owner database invariant rejects unsafe commits;
- concurrent invitation acceptance has one winner;
- concurrent session refresh produces one successor;
- password reset revokes sessions across every tenant and platform scope.

### API end-to-end tests

- bootstrap platform admin activation and login;
- platform tenant provisioning and owner invitation;
- new-user activation, login, explicit acceptance, and tenant activation;
- existing global user invited to a second tenant;
- restricted invitation-pending session cannot access normal tenant endpoints;
- same cookie replayed on another hostname is rejected;
- tenant cookie cannot access platform routes and vice versa;
- invite resend invalidates the old token;
- reset responses do not enumerate accounts;
- password reset revokes all sessions;
- user can list and revoke individual sessions;
- owner and admin grant restrictions;
- final-owner demotion and revocation are rejected;
- inactive membership is denied before product use cases execute.

### Security regression tests

- spoofed `Host` and `x-forwarded-host` values cannot select an unauthorized tenant;
- cookies have exact required attributes and no `Domain` attribute;
- unsafe requests without valid origin or CSRF token are rejected;
- raw tokens and passwords do not appear in logs, traces, outbox JSON, or API responses;
- common-password denylist is enforced;
- progressive delay applies to account, source, and combined keys;
- replaced session-token reuse after grace revokes the session family;
- authorization responses are `no-store`;
- redirect and return URLs cannot escape the current allowed origin;
- invitation and activation tokens are rejected on the wrong hostname.

### Architecture and contract tests

- module dependency checks cover identity, sessions, memberships, and authorization;
- OpenAPI documents every public route and error shape;
- BFF and API contracts remain compatible;
- Prisma types do not leak into application ports;
- no controller or guard imports Prisma adapters directly.

## Migration and Rollout

### Phase 1: additive schema and seeds

- add global identity, role, permission, invitation, membership, session, and token tables;
- add tenant `provisioning` lifecycle support if absent;
- seed immutable system roles and permission mappings;
- add RLS policies, grants, policy-manifest entries, and database constraints;
- keep existing unauthenticated probe behavior only where explicitly required for Foundation tests.

### Phase 2: identity and session kernel

- add password hashing, activation, login, session validation, CSRF, rotation, revocation, and reset;
- add secure token-delivery envelope and email adapter contract;
- add bootstrap platform-admin command;
- expose `/auth/me` and `/auth/me/authorization` as the relevant Plan 1B.4 tasks are completed.

### Phase 3: membership and provisioning vertical slice

- add platform tenant provisioning and initial owner invitation;
- add tenant invitation, restricted session, acceptance, role assignment, and final-owner safeguards;
- add minimal BFF pages and forms.

### Phase 4: enforcement

- place authorization guards on protected tenant and platform routes;
- verify no product route can execute without authenticated scope and required permission;
- remove temporary compatibility paths;
- run full RLS, API E2E, browser smoke, architecture, OpenAPI, migration, secret-scan, and dependency-audit gates.

Rollout remains additive until the complete vertical slice passes. No production deployment should partially require sessions while activation, invitation acceptance, or reset flows are unavailable.

## Acceptance Criteria

Sprint 1B is complete only when all of the following are true:

1. An idempotent non-HTTP bootstrap path can provision the first platform administrator.
2. A platform administrator can authenticate only on the exact platform hostname.
3. A platform administrator can provision a tenant and send its first owner invitation.
4. A new owner can activate an account, sign in, explicitly accept the invitation, and atomically activate the tenant.
5. An existing global user can join a second tenant without a second account or password.
6. Every hostname has an independent host-only session cookie.
7. A tenant session cannot be replayed across tenants or on the platform hostname.
8. Sessions support seven-day idle expiry, 30-day absolute expiry, rotation, reuse detection, listing, and revocation.
9. Password reset is single-use, expires after 30 minutes, is enumeration-safe, and revokes all sessions for the Sprint 1B administrative flow.
10. Tenant owner and tenant admin grant boundaries are enforced, including the final-owner invariant.
11. `/auth/me/authorization` returns authoritative roles, permissions, scope, and authorization versions with `no-store` caching.
12. All tenant-owned identity-access tables have FORCE RLS and pass cross-tenant isolation tests.
13. State-changing browser requests fail without valid same-origin and CSRF proof.
14. Raw secrets are absent from persistent application columns, logs, traces, and unencrypted outbox payloads.
15. OpenAPI, unit, database integration, API E2E, browser smoke, architecture, migration, production-guard, dependency-audit, and secret-scan gates pass.

These criteria describe Sprint 1B completion, not the current implementation state. Until Plan 1B.4 reaches its completion gate, unmet later criteria remain planned work rather than automatic conflicts.

## Risks and Tradeoffs

### Modular-monolith coupling

Keeping identity inside the API minimizes operational complexity but requires strict dependency enforcement. Ports and module checks are mandatory so later extraction remains possible.

### Host-isolated sessions increase login friction

Users may need to sign in separately on each tenant hostname. This is accepted for Sprint 1B because it sharply reduces cookie scope and confused-deputy risk. A future central SSO flow may exchange one-time codes for host-only sessions without changing this session boundary.

### Fixed roles limit product flexibility

Only platform admin, tenant owner, and tenant admin are available in Sprint 1B. This is a transitional authorization bootstrap, not the final RBAC model. The approved delivery bridge is:

```text
Sprint 1B fixed system roles
→ Sprint 2 tenant-scoped dynamic roles
→ Partner-scoped roles with Partner delivery
→ Phase 2 full three-level Role Builder UI
```

Permissions remain code-seeded capability identifiers; role definitions and role-permission mappings are the dynamic layer.

### Global passwords have global blast radius

One password authenticates the global user across every membership. Password reset therefore revokes all sessions across every scope, and high-risk account changes increment the global authorization version.

### Reliable email requires sensitive payload handling

Transactional delivery cannot store plain raw tokens or OTPs. The encrypted outbox envelope adds key-management work but prevents secrets from leaking through database inspection, logs, or dead-letter tooling.

## Deferred Follow-ups

- Sprint 1C subscription and entitlement enforcement in the authorization equation.
- Sprint 2 tenant-scoped dynamic RBAC (custom roles, role-permission mapping, assignment/revocation, grant boundaries, audit/concurrency) over Permission Catalog V2.
- Product-specific tenant member roles and permissions.
- Partner registration via email verification and Partner authorization scope with Partner delivery; affiliate scope follows the relevant marketplace slice.
- Customer registration/password recovery via six-digit Email OTP in the Customer/storefront slice; SMS remains a future replaceable delivery channel.
- Phase 2 full three-level Role Builder UI after the corresponding backend scopes exist.
- MFA and step-up authentication for owner, platform, finance, payout, and recovery actions.
- Central SSO that exchanges one-time codes for host-only tenant sessions.
- Passkeys and external identity providers; Google/Facebook remain deferred/hidden until scheduled.
- Advanced device trust, anomaly detection, and risk-based authentication.

## Implementation Planning Gate — satisfied

The original planning gate is satisfied by the task-level implementation plans:

- `../plans/2026-08-05-sprint-1b-01-identity-foundation.md`
- `../plans/2026-08-05-sprint-1b-02-session-kernel.md`
- `../plans/2026-08-05-sprint-1b-03-membership-provisioning.md`
- `../plans/2026-08-05-sprint-1b-04-authorization-hardening.md`

Current execution follows Plan 1B.4 and `../checkpoints/2026-08-10-sprint-1b-reconciliation.md`. Agents must use current repository evidence and `../../governance/DELIVERY-RECONCILIATION.md` rather than treating the historical planning-gate prose or unchecked recipe boxes as current status.
