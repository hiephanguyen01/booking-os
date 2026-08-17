# Single-Email Initial Owner Onboarding Design

**Date:** 2026-08-16  
**Status:** Approved for implementation planning  
**Branch:** `feat/owner-onboarding-single-email`

## Problem

When a platform administrator provisions a tenant with a brand-new initial owner, Booking OS currently creates two independent security artifacts and dispatches two emails at nearly the same time:

1. an account activation email for the pending global user, and
2. a tenant membership invitation email for the future `tenant_owner`.

The backend behavior is security-correct, but the user journey is confusing because the recipient must infer which email to open first and why two separate messages are required.

## Goal

Reduce initial-owner onboarding for a brand-new user to one email and one continuous browser journey while preserving all current security boundaries:

- account activation remains distinct from membership invitation acceptance;
- the invitation token never authenticates the user;
- password authentication is still required before invitation acceptance;
- invitation acceptance remains explicit and atomic;
- tenant, user, role, session, and token scope binding remain unchanged.

## Non-Goals

This change does not:

- auto-accept the tenant invitation after activation;
- weaken or bypass the `invitation_pending` session requirement;
- change the existing-user invitation flow;
- change tenant-admin invitation behavior;
- introduce public signup;
- move tokens into query strings, local storage, cookies, logs, or server-rendered HTML;
- change membership roles or authorization policy.

## User Experience

### New initial owner

A platform administrator provisions a tenant with an owner email that resolves to a pending/new global identity.

The owner receives exactly one email:

- Subject: `Set up your Booking OS workspace`
- Purpose: activate the account, establish the credential, then continue into invitation review.

The email opens the tenant host activation page using a URL fragment that carries both one-time artifacts:

```text
https://<tenant>.booking.localhost/activate#activation=<ACTIVATION_TOKEN>&invitation=<INVITATION_TOKEN>
```

The browser must consume both fragment values once and immediately remove the sensitive fragment from browser history.

The page then performs the following sequence:

1. user chooses a password;
2. activation completes using the activation token;
3. the web console automatically signs the user in using the server-derived email identity and the password just entered;
4. the API creates an `invitation_pending` tenant session;
5. the browser navigates to `/invite/accept#token=<INVITATION_TOKEN>`;
6. the invitation page consumes and strips the invitation token from the fragment;
7. the user explicitly clicks **Accept invitation**;
8. the existing acceptance flow atomically activates membership, assigns `tenant_owner`, activates the first-owner tenant where applicable, elevates/rotates the session, and redirects to tenant administration.

### Existing active global user

No behavior change.

A user who already has an active global identity and credential receives the existing membership invitation email only. They authenticate with their existing password, obtain an `invitation_pending` session for the target tenant, and explicitly accept the invitation.

## Architecture

### Provisioning workflow

`PlatformTenantProvisioningWorkflow` continues to create both the membership invitation token and, for a pending identity, an activation token.

For a new/pending initial owner, the workflow must append one onboarding outbox event instead of two independent email events. The event envelope contains both encrypted serialized tokens and enough non-sensitive metadata for the email worker to construct the tenant-host onboarding link.

For an already-active owner identity, the workflow continues to append the existing membership invitation event unchanged.

`resendOwnerInvitation` follows the same rule:

- pending owner: invalidate prior invitation/activation artifacts as required by the existing flow and dispatch one replacement onboarding email;
- active owner: dispatch the existing invitation email only.

### Event contract

Introduce a dedicated owner-onboarding email event rather than overloading `account_activation` or `membership_invitation` semantics.

Conceptually:

```ts
type InitialOwnerOnboardingEmailEvent = {
  version: 1;
  recipient: string;
  hostname: string;
  tenantId: string;
  userId: string;
  invitationId: string;
  envelope: EncryptedEnvelopeContaining<{
    activationToken: string;
    invitationToken: string;
  }>;
};
```

The raw token values must exist only inside the encrypted envelope until the worker decrypts them for message construction.

### Email worker

Add a dedicated onboarding template that renders one link containing both values in the fragment.

Example body:

```text
You've been invited to set up your workspace on Booking OS.

Set your password to activate your account, then you'll review your workspace invitation.

https://<hostname>/activate#activation=<...>&invitation=<...>

This link expires in 24 hours.
```

The worker must not log the rendered URL or either token.

### Activation UI

The current activation form is extended to support an optional onboarding continuation.

For normal activation links, behavior remains unchanged.

For onboarding links, the client:

1. consumes `activation` and `invitation` from the URL fragment;
2. strips the fragment from browser history before network submission;
3. submits activation with the chosen password;
4. uses the server-derived continuation email plus the password still held in component memory to call the normal login BFF;
5. on successful login, navigates to `/invite/accept#token=<invitation>`.

No new API authentication shortcut is introduced.

### Obtaining the email for automatic login

The browser must not trust an editable email value derived from the link.

When an activation token is linked to a tenant owner invitation, activation completion returns the minimum continuation metadata needed by the first-party BFF/UI:

```ts
{
  completed: true,
  continuationEmail: string
}
```

`continuationEmail` is derived on the server from the user associated with the consumed activation record. It is never accepted from client input.

For platform activation or any activation token that is not linked to a tenant owner invitation, the response remains the normal shape and omits `continuationEmail`:

```ts
{ completed: true }
```

All activation completion responses remain `no-store` and must not expose the invitation token or other account data.

### Login and invitation acceptance

The existing login use case remains authoritative. It verifies the password and resolves the subject for the exact tenant hostname/scope. A pending valid invitation may therefore produce an `invitation_pending` session exactly as today.

The existing invitation acceptance endpoint remains unchanged in its central security requirement: an authenticated `invitation_pending` tenant session is required before token acceptance.

## Failure and Recovery

### Activation fails

Show the existing activation failure state. No automatic login is attempted.

### Activation succeeds, automatic login fails

Do not ask the user to reactivate the account. The UI shows:

```text
Your account is active, but we couldn't sign you in automatically.
```

Provide:

- **Try again** — retries normal login using the password still in in-memory component state while the page remains open.
- **Continue to sign in** — navigates to `/login#invitation=<INVITATION_TOKEN>`.

The login page consumes and strips that fragment immediately, preserves the invitation token only in in-memory client state, and after a successful login navigates to `/invite/accept#token=<INVITATION_TOKEN>`.

If the page is refreshed after the fragment has been stripped and the in-memory continuation is lost, the owner does not receive a token-recovery shortcut. A platform administrator must use the existing owner-invitation resend action to issue a fresh onboarding/invitation message. No token is persisted in localStorage or sessionStorage.

### Invitation expires before acceptance

The existing invitation error handling remains authoritative. A platform administrator can resend the owner invitation; for a still-pending identity, resend produces a new single onboarding email, otherwise a normal invitation email.

## Security Properties

The implementation must preserve these properties:

- URL query parameters never carry activation or invitation secrets.
- Raw tokens are never persisted in browser storage.
- Raw tokens are never written to application logs or audit metadata.
- Raw tokens are encrypted in outbox payloads at rest.
- Fragment values are removed from browser history before submission.
- Activation token is exact-host/tenant/user/purpose bound as today.
- Invitation token is exact-host/tenant/user/role/purpose bound as today.
- Invitation token alone cannot create a session.
- Password authentication is mandatory before `invitation_pending` session creation.
- Explicit invitation acceptance remains mandatory.
- The final-owner invariant and FORCE RLS behavior are untouched.

## Compatibility

The following flows must remain unchanged:

- platform administrator activation;
- password reset;
- existing active user invited as initial owner;
- tenant-admin invitations;
- membership invitation acceptance semantics;
- session rotation and authorization-version reconciliation.

## Testing Strategy

Implementation follows red-green-refactor.

Required test coverage:

1. provisioning a tenant with a new owner emits exactly one onboarding email event;
2. the onboarding event contains encrypted activation and invitation continuation data and no plaintext token leakage;
3. provisioning with an existing active owner emits exactly one normal invitation email event;
4. owner-invitation resend follows the same pending-vs-active email rule;
5. worker renders one onboarding message with both fragment values and never logs raw tokens;
6. activation UI consumes both fragment values and strips browser history before submission;
7. onboarding activation returns server-derived `continuationEmail`, while platform/non-owner activation omits it;
8. successful activation performs normal password login and receives `invitation_pending` state;
9. successful auto-login routes to invitation review without accepting it;
10. failed auto-login supports retry and sign-in continuation without storing the invitation token persistently;
11. explicit accept still rotates/elevates the session and activates the membership/tenant atomically;
12. platform activation, existing-user invitation, tenant-admin invitation, and password-reset tests remain green;
13. browser E2E proves a new initial owner receives a single message and completes the full flow from that message.

## Acceptance Criteria

The change is complete when:

- a brand-new initial owner receives one and only one email during provisioning;
- that one email is sufficient to activate the account and reach invitation review;
- the user must still explicitly accept the tenant invitation;
- an existing active owner receives one normal invitation email;
- resend preserves the same one-email rule;
- no new auth bypass or token persistence path exists;
- focused unit/integration/E2E tests pass;
- `pnpm verify:foundation` passes on the implementation branch.
