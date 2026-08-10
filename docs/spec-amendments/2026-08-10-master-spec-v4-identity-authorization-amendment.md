# Master Spec V4 Identity and Authorization Amendment

Date: 2026-08-10
Status: Approved
Owner: identity-access
Applies to: `booking-saas-marketplace-master-spec-v4-nextjs.docx`

## Purpose

This amendment records approved delivery decisions made after Master Spec V4.0 (10/07/2026). It supersedes only the conflicting identity/authentication/RBAC details named below. All unaffected Master Spec requirements remain active.

## 1. Permission Catalog V2 is the implementation naming baseline

Master Spec V4 correctly establishes the architectural rule that permissions are fixed identifiers seeded from code while roles and role-permission mappings may become dynamic. That architecture remains approved.

The exact permission examples in Master Spec V4 and the original Sprint 1B design are no longer the canonical naming source for implemented capabilities. Booking OS now uses granular capability/use-case-oriented permission keys owned by code.

### Current implemented catalog

```text
platform.security.audit.read
platform.tenants.provision
platform.users.provision

tenant.membership.read
tenant.membership.admin.invite
tenant.membership.admin.suspend
tenant.membership.admin.revoke
tenant.membership.owner.promote
tenant.membership.owner.demote
tenant.security.session.read
tenant.security.session.revoke
```

These keys are canonical for the capabilities already implemented.

### Naming rules

- Permission keys are lowercase dot-separated identifiers.
- The first segment is the authorization scope (`platform`, `tenant`, later `partner`).
- The final segment is the protected action/capability.
- Intermediate segments describe the bounded domain/resource/target needed to make the capability unambiguous.
- Granular security-sensitive actions are preferred over coarse `*.manage` or broad `*.write` permissions when the operations carry materially different grant or audit risk.
- Permissions are code-seeded and are not created by end users.
- Permission keys are append-only public authorization identifiers. Renaming or removing an issued key requires an explicit migration and compatibility plan.
- Future product modules extend the catalog only when their protected use cases are introduced; this amendment does not pre-create unused listing/booking/payment/finance permissions.

Examples such as `platform.tenants.read/write`, `platform.users.manage`, or `tenant.members.manage` in the original Master Spec remain useful statements of product capability, but they are not exact permission-key contracts after this amendment.

## 2. Dynamic RBAC delivery transition

The target remains dynamic RBAC. Sprint 1B is intentionally a safe bootstrap, not the final role-management surface.

```text
Sprint 1B — Authorization kernel
  fixed immutable system roles
  code-seeded Permission Catalog V2
  authoritative permission/resource guards
  authorization-version invalidation

        ↓

Sprint 2 — Tenant dynamic RBAC foundation
  tenant custom role CRUD
  tenant role-permission mapping
  assign/revoke custom tenant roles
  grant-boundary policy
  authorization-version bump on role/permission changes
  audit + concurrency coverage
  system roles remain immutable

        ↓

Partner delivery — Partner scope extension
  partner authorization scope
  partner system-role foundation
  partner custom roles/assignments when required by Partner product flows

        ↓

Phase 2 — Full three-level Role Builder UI
  platform role-management experience where required
  tenant Role Builder UI
  partner Role Builder UI
```

Dynamic RBAC means roles and role-permission mappings become dynamic. It does **not** mean arbitrary permission strings become user-defined.

## 3. Sprint 1B is the shared auth kernel, not final actor authentication

Sprint 1B establishes reusable identity/security primitives for platform and tenant administration:

- global user identity;
- password credentials;
- opaque host-only sessions;
- session rotation/revocation/reuse detection;
- CSRF and exact-host boundaries;
- authorization versions;
- memberships;
- authoritative authorization context and permission guards.

Its `public self-registration` non-goal applies only to the Sprint 1B administrative slice. It does not remove Customer or Partner registration from the product.

Actor-specific flows must extend the same kernel rather than introduce parallel session/authentication systems.

## 4. Customer authentication initially uses six-digit Email OTP

For initial delivery, Customer registration and Customer password recovery use a six-digit one-time code delivered by email.

This supersedes the Master Spec V4 statement that Customer signup/password recovery must use SMS OTP in the initial phase.

### Customer signup

```text
email
→ issue six-digit Email OTP
→ verify challenge
→ create/activate Customer identity
→ authenticate through the shared opaque-session kernel
```

### Customer forgot/reset password

```text
email
→ issue six-digit Email OTP
→ verify challenge
→ set a new password
→ increment authorization version
→ revoke existing sessions according to password-reset security policy
```

### Delivery-channel rule

The verification domain must not hard-code Email as the only possible channel. Model the challenge independently from delivery so SMS can be added later without redesigning the verification flow.

Conceptually:

```text
VerificationChallenge
  purpose: customer_signup | password_reset
  channel: email (initial) | sms (future)
  code_hash
  attempts
  expires_at
  consumed_at
```

Raw OTP values must not be stored in plaintext application-visible persistence or logs. Enumeration-safe responses, attempt limits, expiry, single-use semantics, CSRF/origin controls, and abuse protection remain mandatory.

SMS OTP is deferred to reduce initial provider/integration/operating cost; it may be introduced later as another delivery adapter/policy.

## 5. Partner authentication remains email-link verification

Partner registration uses an email verification link and later extends the shared identity/session kernel when Partner authorization scope is delivered.

The Partner flow is separate from Customer Email OTP UX but reuses the same identity, secure-token delivery, session, hostname, and authorization invariants.

## 6. Social login is deferred and hidden

Google/Facebook login is not on the initial Pilot critical path.

Until a social provider flow is explicitly scheduled, implemented, security-reviewed, and tested:

- Customer social-login controls remain hidden/disabled in shipped Pilot UI;
- no non-functional Google/Facebook buttons may be exposed to users.

## 7. Security invariants remain unchanged

This amendment does not weaken the existing security direction:

- browser-held access tokens remain prohibited;
- Next.js remains the same-origin BFF boundary;
- session cookies remain exact-host/host-only and are not shared across tenant domains;
- tenant identity is derived from trusted hostname resolution, not client tenant IDs;
- NestJS remains backend-authoritative for authentication/authorization;
- PostgreSQL FORCE RLS remains the final tenant data boundary;
- authorization-version reconciliation remains mandatory for protected requests.

## Supersession summary

This amendment supersedes these details where they conflict:

1. exact permission-key examples in Master Spec V4 / original Sprint 1B design for capabilities already implemented;
2. any interpretation that Sprint 1B fixed roles are the final RBAC model;
3. any interpretation that Sprint 1B's no-self-registration scope removes later Customer/Partner registration;
4. initial Customer SMS OTP requirement for signup/password recovery, replaced by six-digit Email OTP;
5. any Pilot UI requirement to expose social-login buttons before the provider flow is implemented.

All other Master Spec V4 product requirements remain in force unless another explicit dated amendment/ADR supersedes them.
