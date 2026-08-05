# Plan 1 — Task 4: Identity Pages and Completion Gates

**Consumes:** migrated identity forms and UI Card exports from Tasks 2–3.

**Produces:** responsive identity pages with unchanged copy and fresh repository-wide verification evidence.

## Task 4.1: Add Browser Contracts Before Restyling

**Files:**
- Modify: `e2e/identity.spec.ts`

- [ ] **Step 1: Add client-validation and keyboard tests**

```ts
test("invalid activation values do not send a command", async ({ page }) => {
  await page.goto(`${CONSOLE_BASE_URL}/activate#token=${encodeURIComponent(IDENTITY_TOKEN)}`);
  let commands = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/activation/complete")) commands += 1;
  });

  await page.getByLabel("New password", { exact: true }).fill("Long-enough-password-123!");
  await page.getByLabel("Confirm new password", { exact: true }).fill("Different-password-123!");
  await page.getByRole("button", { name: "Activate account" }).click();

  await expect(page.getByRole("alert")).toContainText("The passwords do not match.");
  expect(commands).toBe(0);
});

test("identity shell supports keyboard entry", async ({ page }) => {
  await page.goto(`${CONSOLE_BASE_URL}/password/forgot`);
  await expect(page.locator("main")).toHaveClass(/min-h-screen/);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address")).toBeFocused();
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm build
pnpm exec playwright test e2e/identity.spec.ts
```

Expected: the `min-h-screen` assertion fails before page migration. Existing endpoint, payload, fragment-removal, and neutral-response tests must remain green.

- [ ] **Step 3: Commit RED evidence**

```bash
git add e2e/identity.spec.ts
git commit -m "test(web-console): define identity UI browser contract"
```

## Task 4.2: Apply Shared UI Without Changing Page Copy

**Files:**
- Modify: `apps/web-console/app/activate/page.tsx`
- Modify: `apps/web-console/app/password/forgot/page.tsx`
- Modify: `apps/web-console/app/password/reset/page.tsx`

- [ ] **Step 1: Replace activation page**

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@booking-os/ui/card";
import { ActivationForm } from "../../src/components/identity-forms";

export default function ActivatePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            Booking OS
          </p>
          <CardTitle id="activation-title">Activate your account</CardTitle>
          <CardDescription>
            Choose a secure password to finish activating your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivationForm />
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 2: Replace forgot-password page and preserve enumeration-safe copy**

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@booking-os/ui/card";
import { ForgotPasswordForm } from "../../../src/components/identity-forms";

export default function ForgotPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            Booking OS
          </p>
          <CardTitle id="forgot-password-title">Forgot your password?</CardTitle>
          <CardDescription>
            Request a password reset link without revealing whether an account exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ForgotPasswordForm />
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 3: Replace reset-password page and preserve current copy**

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@booking-os/ui/card";
import { PasswordResetForm } from "../../../src/components/identity-forms";

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">
            Booking OS
          </p>
          <CardTitle id="reset-password-title">Reset your password</CardTitle>
          <CardDescription>Choose a new password to secure your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <PasswordResetForm />
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 4: Run focused GREEN**

```bash
pnpm build
pnpm exec playwright test e2e/identity.spec.ts
```

Expected: all existing and new identity browser tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web-console/app/activate/page.tsx apps/web-console/app/password/forgot/page.tsx apps/web-console/app/password/reset/page.tsx
git commit -m "feat(web-console): apply shared UI foundation to identity"
```

## Task 4.3: Attach the New Gate and Verify the Full Repository

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the boundary check to `verify:foundation`**

Insert `pnpm verify:frontend-libraries` immediately after `pnpm verify:architecture`:

```json
"verify:foundation": "pnpm check:ci && pnpm verify:architecture && pnpm verify:frontend-libraries && pnpm lint && pnpm typecheck && pnpm --filter @booking-os/api prisma:migrate:deploy && pnpm test && pnpm test:e2e:api && pnpm verify:migrations && pnpm build && pnpm test:e2e && pnpm verify:production-config"
```

- [ ] **Step 2: Run all focused package checks**

```bash
node --test scripts/architecture/frontend-library-boundaries.test.mjs
node --test scripts/architecture/frontend-styles.test.mjs
pnpm --filter @booking-os/contracts test
pnpm --filter @booking-os/ui test
pnpm --filter @booking-os/web-console test
pnpm --filter @booking-os/contracts typecheck
pnpm --filter @booking-os/ui typecheck
pnpm --filter @booking-os/web-console typecheck
```

Expected: every command exits `0`.

- [ ] **Step 3: Run complete fresh verification in order**

```bash
pnpm check:ci
pnpm verify:architecture
pnpm verify:frontend-libraries
pnpm lint
pnpm typecheck
pnpm --filter @booking-os/api prisma:migrate:deploy
pnpm test
pnpm test:e2e:api
pnpm verify:migrations
pnpm build
pnpm test:e2e
pnpm verify:production-config
```

Expected: every command exits `0`. Do not infer one gate from another; retain full output or GitHub Actions run links as completion evidence.

- [ ] **Step 4: Verify the final diff is in scope**

```bash
git diff --stat HEAD~7..HEAD
git diff --name-only HEAD~7..HEAD
```

Expected files are limited to:

```text
pnpm-workspace.yaml
pnpm-lock.yaml
package.json
apps/web-console/**
packages/api-client/package.json
packages/contracts/**
packages/ui/**
scripts/architecture/frontend-*.mjs
e2e/identity.spec.ts
```

No API domain, database schema, migration, worker, generated OpenAPI, or infrastructure file may change in this plan.

- [ ] **Step 5: Commit the gate**

```bash
git add package.json
git commit -m "ci(frontend): enforce library foundation boundary"
```

- [ ] **Step 6: Update the draft PR evidence**

Add a PR comment or description section containing:

```markdown
## Frontend Library Foundation Plan 1 evidence

- RED/GREEN commits listed task-by-task.
- Exact dependency and lockfile check: passed.
- UI/contracts/web-console focused tests: passed.
- Identity Playwright journey: passed.
- Full repository verification: passed.
- PR remains draft; no merge requested.
```

Do not mark the PR ready or merge it without explicit user instruction.

## Completion Gate

Before reporting Plan 1 complete, re-read the parent plan checklist and confirm every item against code plus fresh command output. A successful build alone is not sufficient evidence for lint, typecheck, tests, migrations, browser behavior, or production configuration.
