# Platform Admin Activation Happy Path

## Goal

Provide a complete local platform-admin onboarding flow:

1. Run `pnpm --filter @booking-os/api identity:bootstrap-platform-admin -- --hostname platform.booking.localhost`.
2. Deliver an activation email through the configured local mail path.
3. Open its activation link at `platform.booking.localhost`.
4. Set a valid password.
5. Redirect to `/login` after activation succeeds.
6. Sign in with that password and reach the Console.

## Product behavior

Activation remains a one-time-token operation. The browser removes the token fragment after reading it and keeps existing failure handling unchanged. On a successful BFF response, the activation form replaces the current history entry with `/login`; the consumed activation URL cannot be revisited with the Back button.

Activation does not create an authenticated session. Login remains the only operation that establishes a Console session and is responsible for taking the user to the normal Console destination.

## Implementation boundary

The Console activation form owns the post-success redirect. The identity API and BFF response contract remain unchanged: a successful activation still returns `{ completed: true }`.

Add a component-level regression test that proves a successful activation redirects to `/login`, while failures remain on the activation screen.

## End-to-end verification

The existing developer database may already contain the one permitted platform administrator. The E2E test must therefore use a clean, isolated local database and supporting services rather than resetting or modifying the developer's current data.

The test starts the isolated environment, executes the real bootstrap command, reads the resulting activation message from the local email service, and drives a browser through activation and login. It verifies:

- the activation email contains the HTTPS platform activation URL;
- the activation UI accepts the token and redirects to `/login` after a successful password submission;
- login accepts the newly created administrator credentials and establishes the expected Console session; and
- the temporary environment is removed after verification.

## Non-goals

- Do not auto-login after activation.
- Do not change production identity token, session, or role-assignment semantics.
- Do not reset the developer's shared local database.
