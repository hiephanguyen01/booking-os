# Platform Admin Activation Happy Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redirect a newly activated platform administrator to login and verify the real bootstrap-email-activation-login path in an isolated local environment.

**Architecture:** `PasswordCommandForm` remains the shared client form for activation and password reset. It gains a serializable optional success destination; only `ActivationForm` configures `/login`, so password reset remains on its confirmation screen. The live verification uses a clean local database and its matching API, worker, Mailpit, Console, and Caddy processes so it never mutates the developer's current platform-admin state.

**Tech Stack:** Next.js App Router, React Hook Form, Vitest, Playwright/browser testing, NestJS CLI, Prisma/PostgreSQL, BullMQ worker, Mailpit, Caddy, pnpm.

## Global Constraints

- Preserve one-time activation token behavior and remove the fragment before the network request.
- Do not create a session during activation; only `/api/auth/login` establishes the session.
- Keep password-reset success behavior unchanged.
- Test the bootstrap command with `platform.booking.localhost` over HTTPS and consume the link delivered through Mailpit.
- Use a clean isolated database; never reset or alter the developer's existing platform-admin database.

---

## File structure

- `apps/web-console/src/components/identity/password-command-form.tsx` — shared form success behavior with an optional redirect target.
- `apps/web-console/src/components/identity/activation-form.tsx` — activation-only configuration for the login destination.
- `apps/web-console/src/components/identity/identity-forms.test.tsx` — component behavior for successful activation redirect and unchanged reset behavior.
- `docs/runbooks/local-https-development.md` — repeatable clean-environment happy-path verification instructions.

### Task 1: Redirect successful activation to Login

**Files:**
- Modify: `apps/web-console/src/components/identity/password-command-form.tsx:36-104`
- Modify: `apps/web-console/src/components/identity/activation-form.tsx:3-11`
- Test: `apps/web-console/src/components/identity/identity-forms.test.tsx:31-56`

**Interfaces:**
- Consumes: `PasswordCommandFormProps.action`, `successMessage`, and a new optional `successRedirectPath?: "/login"`.
- Produces: successful activation invokes `window.location.replace("/login")`; password reset still renders its success status.

- [ ] **Step 1: Write the failing activation redirect test**

Add a test that mocks the browser navigation boundary, renders `ActivationForm`, provides the fragment token and matching password, resolves `fetch` with HTTP 200, and asserts the navigation target is `/login` rather than the activation success status.

```tsx
it("redirects to login after a successful activation", async () => {
  const replace = vi.spyOn(window.location, "replace").mockImplementation(() => undefined);
  render(<ActivationForm />);
  // submit matching values after mocking a 200 response
  expect(replace).toHaveBeenCalledWith("/login");
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter @booking-os/web-console exec vitest run src/components/identity/identity-forms.test.tsx
```

Expected: the new test fails because `ActivationForm` has no login redirect behavior.

- [ ] **Step 3: Implement the minimal serializable redirect configuration**

Add `successRedirectPath?: string` to `PasswordCommandFormProps`. After a successful response, call `window.location.replace(successRedirectPath)` when the prop is present; otherwise preserve `setSubmission({ state: "success", message: successMessage })`. Pass `successRedirectPath="/login"` from `ActivationForm`. Do not set this prop for `PasswordResetForm`.

```tsx
if (response.ok) {
  if (successRedirectPath) {
    window.location.replace(successRedirectPath);
    return;
  }
  setSubmission({ state: "success", message: successMessage });
}
```

- [ ] **Step 4: Run focused verification**

Run:

```bash
pnpm --filter @booking-os/web-console exec vitest run src/components/identity/identity-forms.test.tsx
pnpm --filter @booking-os/web-console lint
pnpm --filter @booking-os/web-console typecheck
```

Expected: all identity-form tests, lint, and typecheck pass.

- [ ] **Step 5: Commit the UI change**

```bash
git add apps/web-console/src/components/identity/password-command-form.tsx \
  apps/web-console/src/components/identity/activation-form.tsx \
  apps/web-console/src/components/identity/identity-forms.test.tsx
git commit -m "feat(console): redirect activation success to login"
```

### Task 2: Document isolated happy-path verification

**Files:**
- Modify: `docs/runbooks/local-https-development.md:180-215`

**Interfaces:**
- Consumes: bootstrap CLI environment (`IDENTITY_BOOTSTRAP_ENABLED`, `IDENTITY_BOOTSTRAP_ADMIN_EMAIL`), Mailpit at port 8025, Caddy HTTPS host, and Login form.
- Produces: an exact, non-destructive runbook sequence for bootstrap → Mailpit link → activation → login.

- [ ] **Step 1: Write the failing runbook acceptance checklist**

Add the following checklist before changing the existing instructions:

```markdown
- [ ] Bootstrap prints `{ "created": true }`.
- [ ] Mailpit contains one `account_activation` message for the configured administrator.
- [ ] The message link uses `https://platform.booking.localhost/activate#token=`.
- [ ] Activation redirects to `/login` after the password is accepted.
- [ ] Login accepts that email and password and reaches `/`.
```

- [ ] **Step 2: Verify the current manual flow cannot meet the checklist**

Run the bootstrap command against the existing developer database only when it is known clean; otherwise record the expected `PlatformAdminAlreadyBootstrappedError` and do not reset the database.

```bash
pnpm --filter @booking-os/api identity:bootstrap-platform-admin -- \
  --hostname platform.booking.localhost
```

Expected: a non-clean database cannot be used as the happy-path fixture.

- [ ] **Step 3: Add the isolated-environment procedure**

Document these fixed stages: create a disposable PostgreSQL database; point temporary API and worker processes at it with matching token/envelope settings; run Prisma migration and seed roles; start Mailpit, API, worker, Console, and Caddy; run bootstrap; filter Mailpit by the generated admin email; open the delivered link; activate; verify `/login`; login; stop temporary processes and drop only the disposable database.

- [ ] **Step 4: Run the documented happy path**

Use a generated `happy-path-<timestamp>@example.test` administrator and `correct horse battery staple` password. Confirm all checklist entries, then remove the temporary database and processes.

Expected: no user database rows, existing Mailpit messages, or active local services are altered.

- [ ] **Step 5: Commit the runbook change**

```bash
git add docs/runbooks/local-https-development.md
git commit -m "docs: verify platform activation happy path"
```

### Task 3: Final regression and live browser verification

**Files:**
- Verify: `apps/web-console/src/components/identity/identity-forms.test.tsx`
- Verify: `apps/web-console/src/components/session/login-form.test.tsx`
- Verify: `docs/runbooks/local-https-development.md`

**Interfaces:**
- Consumes: Task 1 redirect behavior and Task 2 clean environment.
- Produces: evidence that the real happy path ends in an authenticated Console session.

- [ ] **Step 1: Run all Console tests**

```bash
pnpm --filter @booking-os/web-console test
pnpm --filter @booking-os/web-console lint
pnpm --filter @booking-os/web-console typecheck
```

Expected: all tests, lint, and typecheck pass.

- [ ] **Step 2: Drive the complete browser flow**

In the isolated environment, use the Mailpit activation link, submit matching password fields, wait for `https://platform.booking.localhost/login`, submit the generated bootstrap email and password, and verify the browser reaches `https://platform.booking.localhost/` with an authenticated Console response.

- [ ] **Step 3: Verify persisted security state**

Query the disposable database and confirm the bootstrap user is `active`, has one password credential, has a consumed activation token, has an active platform session, and has a non-revoked `platform_admin` assignment.

- [ ] **Step 4: Remove isolated test resources**

Stop only the temporary API, worker, Console, Caddy, and Compose project. Drop only the generated disposable PostgreSQL database and verify the developer's original database URL was never targeted.

- [ ] **Step 5: Confirm the verification left no application changes**

```bash
git status --short
```

Expected: only pre-existing user changes are listed; the verification created no uncommitted application files.
