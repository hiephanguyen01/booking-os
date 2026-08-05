# Frontend Library Foundation Plan 1: UI and Identity Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish dependency governance, Tailwind CSS, reusable UI primitives, typed identity schemas, and React Hook Form integration through the existing activation, forgot-password, and reset-password vertical slice.

**Architecture:** Keep both Next.js root layouts server-rendered and introduce no global client provider in this plan. Tailwind compilation belongs to `apps/web-console`, semantic tokens and reusable components belong to `packages/ui`, validation schemas belong to `packages/contracts`, and identity orchestration remains in `apps/web-console`. Existing BFF routes and fragment-token security behavior remain unchanged.

**Tech Stack:** pnpm 10, Turborepo 2, Next.js 16.2.12, React 19.2.8, TypeScript 5.9.3, Tailwind CSS 4.3.3, React Hook Form 7.83.0, Zod 4.4.3, Vitest 4.1.10, React Testing Library 16.3.2, Playwright 1.62.0.

## Global Constraints

- Use Node.js `>=22.0.0 <25.0.0` and pnpm `>=10.0.0 <11.0.0`.
- Keep Next.js at `16.2.12`, React and React DOM at `19.2.8`, TypeScript at `5.9.3`, and Biome at `2.5.6`.
- Pin every new dependency exactly; package manifests consume workspace catalog entries where the package is used by more than one workspace.
- Server Components remain the default; only interactive identity form modules use `"use client"`.
- Do not add Axios, TanStack Query, Zustand, `nuqs`, `next-intl`, date libraries, table libraries, or unused shadcn components in this plan.
- Do not change the request body, URL, cookie, CSRF, origin-validation, or fragment-token behavior of existing identity BFF routes.
- Do not store activation tokens, reset tokens, passwords, email addresses, session data, or permission data in browser persistence.
- Shared presentation components live in `packages/ui`; identity orchestration and copy remain in `apps/web-console` until the i18n plan.
- Validation produces stable machine-readable codes; components do not embed translated prose inside schemas.
- Each task follows RED → GREEN → focused verification → commit.
- Generated OpenAPI files are not edited manually.
- Existing architecture, lint, typecheck, unit, API E2E, build, Playwright, production-config, and Sprint gates must remain green.

---

## File Structure Locked by This Plan

```text
apps/web-console/
├── app/
│   ├── activate/page.tsx
│   ├── password/forgot/page.tsx
│   ├── password/reset/page.tsx
│   └── globals.css
├── postcss.config.mjs
├── src/components/identity/
│   ├── activation-form.tsx
│   ├── forgot-password-form.tsx
│   ├── password-command-form.tsx
│   ├── password-reset-form.tsx
│   ├── submission-message.tsx
│   └── index.ts
├── src/components/identity/identity-forms.test.tsx
├── src/lib/identity/post-identity-command.ts
├── src/test/setup.ts
└── vitest.config.ts

packages/contracts/
├── src/identity/forms.ts
├── src/identity/index.ts
├── tests/identity-forms.test.ts
└── package.json

packages/ui/
├── src/components/
│   ├── alert.tsx
│   ├── button.tsx
│   ├── card.tsx
│   ├── form-field.tsx
│   ├── input.tsx
│   ├── label.tsx
│   └── submit-button.tsx
├── src/lib/cn.ts
├── src/styles/
│   ├── base.css
│   ├── index.css
│   └── tokens.css
├── tests/
│   ├── cn.test.ts
│   ├── form-components.test.tsx
│   └── primitives.test.tsx
└── package.json

scripts/architecture/
├── frontend-library-boundaries.mjs
└── frontend-library-boundaries.test.mjs
```

---

### Task 1: Pin Plan 1 Dependencies and Add Frontend Boundary Enforcement

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `packages/contracts/package.json`
- Modify: `packages/api-client/package.json`
- Modify: `packages/ui/package.json`
- Modify: `apps/web-console/package.json`
- Create: `scripts/architecture/frontend-library-boundaries.mjs`
- Create: `scripts/architecture/frontend-library-boundaries.test.mjs`
- Modify: `pnpm-lock.yaml` through `pnpm install --lockfile-only`

**Interfaces:**
- Consumes: existing workspace package manifests and root scripts.
- Produces: `verify:frontend-libraries` root command and `verifyFrontendLibraryBoundaries(rootDir): Promise<readonly string[]>`.

- [ ] **Step 1: Write the failing boundary test**

Create `scripts/architecture/frontend-library-boundaries.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyFrontendLibraryBoundaries } from "./frontend-library-boundaries.mjs";

async function writeFixture(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

test("accepts catalog-pinned UI and form dependencies with no forbidden imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "booking-os-frontend-boundary-"));

  await writeFixture(
    root,
    "pnpm-workspace.yaml",
    [
      "catalog:",
      '  tailwindcss: "4.3.3"',
      '  react-hook-form: "7.83.0"',
      '  zod: "4.4.3"',
      "",
    ].join("\n"),
  );
  await writeFixture(
    root,
    "packages/ui/package.json",
    JSON.stringify({ dependencies: { clsx: "catalog:", "tailwind-merge": "catalog:" } }),
  );
  await writeFixture(
    root,
    "apps/web-console/src/form.tsx",
    'import { useForm } from "react-hook-form";\nexport const form = useForm;\n',
  );

  assert.deepEqual(await verifyFrontendLibraryBoundaries(root), []);
});

test("rejects direct axios imports and unpinned dependency ranges", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "booking-os-frontend-boundary-"));

  await writeFixture(root, "pnpm-workspace.yaml", "catalog:\n  tailwindcss: ^4.3.3\n");
  await writeFixture(
    root,
    "apps/web-console/src/bad-client.ts",
    'import axios from "axios";\nexport default axios;\n',
  );

  const violations = await verifyFrontendLibraryBoundaries(root);
  assert.equal(violations.some((value) => value.includes("exact version")), true);
  assert.equal(violations.some((value) => value.includes("direct axios import")), true);
});
```

- [ ] **Step 2: Run the boundary test to verify RED**

Run:

```bash
node --test scripts/architecture/frontend-library-boundaries.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `frontend-library-boundaries.mjs`.

- [ ] **Step 3: Implement the boundary verifier**

Create `scripts/architecture/frontend-library-boundaries.mjs`:

```js
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const IGNORED_DIRECTORIES = new Set([".git", ".next", ".turbo", "dist", "node_modules"]);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(absolute)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }

  return files;
}

function isExactVersion(value) {
  return typeof value === "string" && (/^\d+\.\d+\.\d+/.test(value) || value === "catalog:" || value === "workspace:*");
}

export async function verifyFrontendLibraryBoundaries(rootDir) {
  const violations = [];
  const workspaceYaml = await readFile(path.join(rootDir, "pnpm-workspace.yaml"), "utf8").catch(() => "");

  for (const line of workspaceYaml.split("\n")) {
    const match = line.match(/^\s{2}["']?([^"':]+)["']?:\s*["']?([^"']+)["']?\s*$/);
    if (match && !isExactVersion(match[2])) {
      violations.push(`catalog dependency ${match[1]} must use an exact version; received ${match[2]}`);
    }
  }

  for (const app of ["apps/web-console", "apps/web-storefront"]) {
    const files = await collectSourceFiles(path.join(rootDir, app));
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/from\s+["']axios["']|import\s*\(["']axios["']\)/.test(source)) {
        violations.push(`${path.relative(rootDir, file)} contains a direct axios import`);
      }
    }
  }

  return violations;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const violations = await verifyFrontendLibraryBoundaries(process.cwd());
  if (violations.length > 0) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  }
}
```

- [ ] **Step 4: Add exact catalog entries and package dependencies**

Extend `pnpm-workspace.yaml` catalog with:

```yaml
  "@hookform/resolvers": 5.5.7
  "@tailwindcss/postcss": 4.3.3
  "@testing-library/dom": 10.4.1
  "@testing-library/react": 16.3.2
  "@testing-library/user-event": 14.6.1
  class-variance-authority: 0.7.1
  clsx: 2.1.1
  jsdom: 29.1.1
  postcss: 8.5.23
  react-hook-form: 7.83.0
  tailwind-merge: 3.6.0
  tailwindcss: 4.3.3
  vitest: 4.1.10
  zod: 4.4.3
```

Use these package ownership rules:

```text
packages/contracts dependencies:
- zod: catalog:

packages/api-client dependencies:
- replace zod 4.4.3 with zod: catalog:

packages/ui dependencies:
- class-variance-authority: catalog:
- clsx: catalog:
- tailwind-merge: catalog:

packages/ui devDependencies:
- vitest: catalog:

apps/web-console dependencies:
- @hookform/resolvers: catalog:
- react-hook-form: catalog:

apps/web-console devDependencies:
- @testing-library/dom: catalog:
- @testing-library/react: catalog:
- @testing-library/user-event: catalog:
- @tailwindcss/postcss: catalog:
- jsdom: catalog:
- postcss: catalog:
- tailwindcss: catalog:
- vitest: catalog:
```

Add to root `package.json`:

```json
{
  "scripts": {
    "verify:frontend-libraries": "node scripts/architecture/frontend-library-boundaries.mjs"
  }
}
```

Do not add dependencies for later plans.

- [ ] **Step 5: Refresh the lockfile and verify GREEN**

Run:

```bash
pnpm install --lockfile-only
node --test scripts/architecture/frontend-library-boundaries.test.mjs
pnpm verify:frontend-libraries
```

Expected: lockfile update succeeds; both verification commands exit `0`.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml packages/contracts/package.json packages/api-client/package.json packages/ui/package.json apps/web-console/package.json scripts/architecture/frontend-library-boundaries.mjs scripts/architecture/frontend-library-boundaries.test.mjs
git commit -m "build(frontend): govern UI and form dependencies"
```

---

### Task 2: Establish Tailwind Compilation and Shared Semantic Tokens

**Files:**
- Create: `apps/web-console/postcss.config.mjs`
- Create: `packages/ui/src/styles/tokens.css`
- Create: `packages/ui/src/styles/base.css`
- Create: `packages/ui/src/styles/index.css`
- Modify: `packages/ui/package.json`
- Modify: `apps/web-console/app/globals.css`
- Create: `scripts/architecture/frontend-styles.test.mjs`

**Interfaces:**
- Consumes: Tailwind and PostCSS catalog dependencies from Task 1.
- Produces: package export `@booking-os/ui/styles.css` and semantic Tailwind utilities such as `bg-background`, `text-foreground`, `bg-primary`, `text-destructive`, and `border-border`.

- [ ] **Step 1: Write the failing style contract test**

Create `scripts/architecture/frontend-styles.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("web console compiles Tailwind and scans shared UI components", async () => {
  const [postcss, globals] = await Promise.all([
    read("apps/web-console/postcss.config.mjs"),
    read("apps/web-console/app/globals.css"),
  ]);

  assert.match(postcss, /@tailwindcss\/postcss/);
  assert.match(globals, /@import\s+["']tailwindcss["']/);
  assert.match(globals, /@source\s+["'][^"']*packages\/ui\/src/);
  assert.match(globals, /@import\s+["']@booking-os\/ui\/styles\.css["']/);
});

test("shared UI stylesheet defines semantic tokens", async () => {
  const tokens = await read("packages/ui/src/styles/tokens.css");
  for (const token of ["--background", "--foreground", "--primary", "--destructive", "--border", "--ring"]) {
    assert.equal(tokens.includes(token), true, `missing ${token}`);
  }
});
```

- [ ] **Step 2: Run the style test to verify RED**

Run:

```bash
node --test scripts/architecture/frontend-styles.test.mjs
```

Expected: FAIL with `ENOENT` for `apps/web-console/postcss.config.mjs`.

- [ ] **Step 3: Add PostCSS configuration**

Create `apps/web-console/postcss.config.mjs`:

```js
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
```

- [ ] **Step 4: Add semantic token styles**

Create `packages/ui/src/styles/tokens.css`:

```css
:root {
  --background: oklch(0.985 0.004 250);
  --foreground: oklch(0.22 0.025 255);
  --card: oklch(1 0 0);
  --card-foreground: var(--foreground);
  --primary: oklch(0.48 0.17 258);
  --primary-foreground: oklch(0.985 0.004 250);
  --secondary: oklch(0.94 0.01 255);
  --secondary-foreground: oklch(0.3 0.03 255);
  --muted: oklch(0.95 0.008 255);
  --muted-foreground: oklch(0.5 0.025 255);
  --destructive: oklch(0.56 0.2 27);
  --destructive-foreground: oklch(0.985 0.004 250);
  --success: oklch(0.55 0.15 150);
  --warning: oklch(0.72 0.16 75);
  --border: oklch(0.88 0.012 255);
  --input: var(--border);
  --ring: oklch(0.58 0.15 258);
  --radius: 0.75rem;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 0.25rem);
  --radius-md: calc(var(--radius) - 0.125rem);
  --radius-lg: var(--radius);
}
```

Create `packages/ui/src/styles/base.css`:

```css
* {
  border-color: var(--border);
}

body {
  background: var(--background);
  color: var(--foreground);
  font-family: Arial, Helvetica, sans-serif;
  text-rendering: optimizeLegibility;
}

:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
```

Create `packages/ui/src/styles/index.css`:

```css
@import "./tokens.css";
@import "./base.css";
```

- [ ] **Step 5: Export and consume the stylesheet**

Add this export to `packages/ui/package.json`:

```json
{
  "exports": {
    "./styles.css": "./src/styles/index.css"
  }
}
```

Replace `apps/web-console/app/globals.css` with:

```css
@import "tailwindcss";
@source "../../../packages/ui/src/**/*.{ts,tsx}";
@import "@booking-os/ui/styles.css";

html,
body {
  min-height: 100%;
}

body {
  margin: 0;
}
```

- [ ] **Step 6: Verify style compilation GREEN**

Run:

```bash
node --test scripts/architecture/frontend-styles.test.mjs
pnpm --filter @booking-os/web-console build
```

Expected: style contract tests pass and Next.js build exits `0` without unknown utility or CSS import errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web-console/postcss.config.mjs apps/web-console/app/globals.css packages/ui/src/styles packages/ui/package.json scripts/architecture/frontend-styles.test.mjs
git commit -m "feat(ui): establish Tailwind semantic tokens"
```

---

### Task 3: Add Shared Class Utility and Identity UI Primitives

**Files:**
- Create: `packages/ui/src/lib/cn.ts`
- Create: `packages/ui/src/components/button.tsx`
- Create: `packages/ui/src/components/input.tsx`
- Create: `packages/ui/src/components/label.tsx`
- Create: `packages/ui/src/components/card.tsx`
- Create: `packages/ui/src/components/alert.tsx`
- Create: `packages/ui/tests/cn.test.ts`
- Create: `packages/ui/tests/primitives.test.tsx`
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/vitest.config.ts`

**Interfaces:**
- Consumes: semantic Tailwind utilities from Task 2.
- Produces: `cn(...inputs): string`, `Button`, `Input`, `Label`, `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, and `Alert` subpath exports.

- [ ] **Step 1: Write failing tests for class merging and primitives**

Create `packages/ui/tests/cn.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { cn } from "../src/lib/cn.js";

describe("cn", () => {
  it("merges conditional classes and resolves Tailwind conflicts", () => {
    expect(cn("px-2", false && "hidden", ["py-1", "px-4"])).toBe("py-1 px-4");
  });
});
```

Create `packages/ui/tests/primitives.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Alert } from "../src/components/alert.js";
import { Button } from "../src/components/button.js";
import { Card, CardContent, CardTitle } from "../src/components/card.js";
import { Input } from "../src/components/input.js";
import { Label } from "../src/components/label.js";

describe("identity UI primitives", () => {
  it("renders accessible form controls with semantic classes", () => {
    const html = renderToStaticMarkup(
      <>
        <Label htmlFor="email">Email address</Label>
        <Input id="email" type="email" aria-invalid="true" />
        <Button type="submit">Continue</Button>
      </>,
    );

    expect(html).toContain('for="email"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("bg-primary");
  });

  it("renders card and alert semantics", () => {
    const html = renderToStaticMarkup(
      <Card>
        <CardTitle>Activate account</CardTitle>
        <CardContent>
          <Alert variant="destructive">Invalid link</Alert>
        </CardContent>
      </Card>,
    );

    expect(html).toContain("Activate account");
    expect(html).toContain('role="alert"');
    expect(html).toContain('data-variant="destructive"');
  });
});
```

- [ ] **Step 2: Run package tests to verify RED**

Run:

```bash
pnpm --filter @booking-os/ui test
```

Expected: FAIL because `cn.ts` and primitive component modules do not exist.

- [ ] **Step 3: Implement `cn`**

Create `packages/ui/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Implement Button and field primitives**

Create `packages/ui/src/components/button.tsx`:

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-semibold transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        ghost: "hover:bg-muted",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-6",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
```

Create `packages/ui/src/components/input.tsx`:

```tsx
import type { InputHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}
```

Create `packages/ui/src/components/label.tsx`:

```tsx
import type { LabelHTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}
```

- [ ] **Step 5: Implement Card and Alert**

Create `packages/ui/src/components/card.tsx` with focused wrappers:

```tsx
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

export const Card = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />
);
export const CardHeader = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />
);
export const CardTitle = ({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) => (
  <h1 className={cn("text-2xl font-semibold tracking-tight", className)} {...props} />
);
export const CardDescription = ({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn("text-sm text-muted-foreground", className)} {...props} />
);
export const CardContent = ({ className, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("p-6 pt-0", className)} {...props} />
);
```

Create `packages/ui/src/components/alert.tsx`:

```tsx
import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn.js";

const alertVariants = cva("rounded-md border p-3 text-sm", {
  variants: {
    variant: {
      default: "bg-card text-card-foreground",
      destructive: "border-destructive/40 bg-destructive/10 text-destructive",
      success: "border-success/40 bg-success/10 text-foreground",
    },
  },
  defaultVariants: { variant: "default" },
});

export interface AlertProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof alertVariants> {}

export function Alert({ className, variant, role = "alert", ...props }: AlertProps) {
  return (
    <div
      role={role}
      data-variant={variant ?? "default"}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}
```

- [ ] **Step 6: Add subpath exports and include `.ts` tests**

Update `packages/ui/package.json` exports:

```json
{
  "exports": {
    "./alert": { "types": "./dist/components/alert.d.ts", "import": "./src/components/alert.tsx" },
    "./button": { "types": "./dist/components/button.d.ts", "import": "./src/components/button.tsx" },
    "./card": { "types": "./dist/components/card.d.ts", "import": "./src/components/card.tsx" },
    "./input": { "types": "./dist/components/input.d.ts", "import": "./src/components/input.tsx" },
    "./label": { "types": "./dist/components/label.d.ts", "import": "./src/components/label.tsx" },
    "./cn": { "types": "./dist/lib/cn.d.ts", "import": "./src/lib/cn.ts" }
  }
}
```

Update `packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
```

- [ ] **Step 7: Verify primitives GREEN**

Run:

```bash
pnpm --filter @booking-os/ui test
pnpm --filter @booking-os/ui typecheck
pnpm --filter @booking-os/ui build
```

Expected: all three commands exit `0`.

- [ ] **Step 8: Commit**

```bash
git add packages/ui/src/lib packages/ui/src/components packages/ui/tests packages/ui/package.json packages/ui/vitest.config.ts
git commit -m "feat(ui): add identity form primitives"
```

---

### Task 4: Define Stable Identity Form Schemas in Contracts

**Files:**
- Create: `packages/contracts/src/identity/forms.ts`
- Create: `packages/contracts/src/identity/index.ts`
- Create: `packages/contracts/tests/identity-forms.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`

**Interfaces:**
- Consumes: Zod `4.4.3` from Task 1.
- Produces: `forgotPasswordFormSchema`, `passwordCommandFormSchema`, `ForgotPasswordFormValues`, `PasswordCommandFormValues`, and package export `@booking-os/contracts/identity`.

- [ ] **Step 1: Write failing schema tests**

Create `packages/contracts/tests/identity-forms.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  forgotPasswordFormSchema,
  passwordCommandFormSchema,
} from "../src/identity/index.js";

test("forgot-password accepts normalized email and rejects malformed email with stable code", () => {
  assert.deepEqual(forgotPasswordFormSchema.parse({ email: " User@Example.Test " }), {
    email: "user@example.test",
  });

  const result = forgotPasswordFormSchema.safeParse({ email: "not-an-email" });
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.issues[0]?.message, "INVALID_EMAIL");
});

test("password command requires 12 characters and matching confirmation", () => {
  const shortResult = passwordCommandFormSchema.safeParse({
    newPassword: "short",
    confirmation: "short",
  });
  assert.equal(shortResult.success, false);
  if (!shortResult.success) assert.equal(shortResult.error.issues[0]?.message, "PASSWORD_TOO_SHORT");

  const mismatchResult = passwordCommandFormSchema.safeParse({
    newPassword: "Long-enough-password-123!",
    confirmation: "Different-password-123!",
  });
  assert.equal(mismatchResult.success, false);
  if (!mismatchResult.success) {
    assert.equal(mismatchResult.error.issues.at(-1)?.message, "PASSWORD_CONFIRMATION_MISMATCH");
    assert.deepEqual(mismatchResult.error.issues.at(-1)?.path, ["confirmation"]);
  }
});
```

- [ ] **Step 2: Run contract tests to verify RED**

Run:

```bash
pnpm --filter @booking-os/contracts test
```

Expected: FAIL because `src/identity/index.ts` does not exist.

- [ ] **Step 3: Implement schemas**

Create `packages/contracts/src/identity/forms.ts`:

```ts
import { z } from "zod";

export const forgotPasswordFormSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email({ error: "INVALID_EMAIL" }),
});

export const passwordCommandFormSchema = z
  .object({
    newPassword: z.string().min(12, { error: "PASSWORD_TOO_SHORT" }),
    confirmation: z.string().min(1, { error: "REQUIRED" }),
  })
  .refine((value) => value.newPassword === value.confirmation, {
    path: ["confirmation"],
    error: "PASSWORD_CONFIRMATION_MISMATCH",
  });

export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordFormSchema>;
export type PasswordCommandFormValues = z.infer<typeof passwordCommandFormSchema>;
```

Create `packages/contracts/src/identity/index.ts`:

```ts
export {
  forgotPasswordFormSchema,
  passwordCommandFormSchema,
  type ForgotPasswordFormValues,
  type PasswordCommandFormValues,
} from "./forms.js";
```

Add to `packages/contracts/src/index.ts`:

```ts
export * from "./identity/index.js";
```

Add this export to `packages/contracts/package.json`:

```json
{
  "exports": {
    "./identity": {
      "types": "./dist/identity/index.d.ts",
      "import": "./dist/identity/index.js"
    }
  }
}
```

- [ ] **Step 4: Verify contracts GREEN**

Run:

```bash
pnpm --filter @booking-os/contracts test
pnpm --filter @booking-os/contracts typecheck
pnpm --filter @booking-os/contracts build
```

Expected: schema tests pass and build emits `dist/identity/index.js` and declarations.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src/identity packages/contracts/src/index.ts packages/contracts/tests/identity-forms.test.ts packages/contracts/package.json
git commit -m "feat(contracts): add identity form schemas"
```

---

### Task 5: Add Shared Form Presentation Components

**Files:**
- Create: `packages/ui/src/components/form-field.tsx`
- Create: `packages/ui/src/components/submit-button.tsx`
- Create: `packages/ui/tests/form-components.test.tsx`
- Modify: `packages/ui/package.json`

**Interfaces:**
- Consumes: `Button`, `Input`, `Label`, `Alert`, and `cn` from Task 3.
- Produces: `FormField`, `FieldError`, `SubmitButton`, and their subpath exports. These are presentation-only and do not import React Hook Form.

- [ ] **Step 1: Write failing form presentation tests**

Create `packages/ui/tests/form-components.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FieldError, FormField } from "../src/components/form-field.js";
import { SubmitButton } from "../src/components/submit-button.js";

it("connects field label, description, control, and error semantics", () => {
  const html = renderToStaticMarkup(
    <FormField
      id="password"
      label="New password"
      description="Use at least 12 characters."
      error="Password is too short."
    >
      <input id="password" aria-invalid="true" />
    </FormField>,
  );

  expect(html).toContain('for="password"');
  expect(html).toContain('id="password-description"');
  expect(html).toContain('id="password-error"');
  expect(html).toContain('role="alert"');
});

it("renders stable submit labels", () => {
  expect(renderToStaticMarkup(<SubmitButton idleLabel="Save" pendingLabel="Saving…" />)).toContain(
    "Save",
  );
  expect(
    renderToStaticMarkup(<SubmitButton idleLabel="Save" pendingLabel="Saving…" pending />),
  ).toContain("Saving…");
  expect(renderToStaticMarkup(<FieldError>Invalid value</FieldError>)).toContain("Invalid value");
});
```

- [ ] **Step 2: Run UI tests to verify RED**

Run:

```bash
pnpm --filter @booking-os/ui test
```

Expected: FAIL because form presentation modules do not exist.

- [ ] **Step 3: Implement form presentation components**

Create `packages/ui/src/components/form-field.tsx`:

```tsx
import type { ReactNode } from "react";
import { Label } from "./label.js";

interface FormFieldProps {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly error?: string;
  readonly children: ReactNode;
}

export function FieldError({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="text-sm text-destructive" role="alert">{children}</p>;
}

export function FormField({ id, label, description, error, children }: FormFieldProps) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {description ? (
        <p id={`${id}-description`} className="text-sm text-muted-foreground">{description}</p>
      ) : null}
      {error ? <div id={`${id}-error`}><FieldError>{error}</FieldError></div> : null}
    </div>
  );
}
```

Create `packages/ui/src/components/submit-button.tsx`:

```tsx
import type { ButtonProps } from "./button.js";
import { Button } from "./button.js";

interface SubmitButtonProps extends Omit<ButtonProps, "children" | "type"> {
  readonly idleLabel: string;
  readonly pendingLabel: string;
  readonly pending?: boolean;
}

export function SubmitButton({ idleLabel, pendingLabel, pending = false, disabled, ...props }: SubmitButtonProps) {
  return (
    <Button type="submit" disabled={disabled || pending} aria-busy={pending} {...props}>
      {pending ? pendingLabel : idleLabel}
    </Button>
  );
}
```

- [ ] **Step 4: Export and verify GREEN**

Add subpath exports:

```json
{
  "exports": {
    "./form-field": {
      "types": "./dist/components/form-field.d.ts",
      "import": "./src/components/form-field.tsx"
    },
    "./submit-button": {
      "types": "./dist/components/submit-button.d.ts",
      "import": "./src/components/submit-button.tsx"
    }
  }
}
```

Run:

```bash
pnpm --filter @booking-os/ui test
pnpm --filter @booking-os/ui typecheck
```

Expected: all UI tests pass and typecheck exits `0`.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/form-field.tsx packages/ui/src/components/submit-button.tsx packages/ui/tests/form-components.test.tsx packages/ui/package.json
git commit -m "feat(ui): add shared form presentation components"
```

---

### Task 6: Configure Browser-Like Component Tests for Web Console

**Files:**
- Create: `apps/web-console/vitest.config.ts`
- Create: `apps/web-console/src/test/setup.ts`
- Modify: `apps/web-console/package.json`
- Create: `apps/web-console/src/components/identity/identity-forms.test.tsx`

**Interfaces:**
- Consumes: Testing Library, user-event, JSDOM, and Vitest dependencies from Task 1.
- Produces: a component-test runner included in the existing `@booking-os/web-console test` command.

- [ ] **Step 1: Add a failing component-test smoke file**

Create `apps/web-console/src/components/identity/identity-forms.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ForgotPasswordForm } from "./forgot-password-form.js";

describe("identity form test environment", () => {
  it("renders the forgot-password form by accessible label", () => {
    render(<ForgotPasswordForm />);
    expect(screen.getByLabelText("Email address")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the intended test command to verify RED**

Run:

```bash
pnpm --filter @booking-os/web-console test
```

Expected: FAIL because the current script does not execute Vitest and `forgot-password-form.tsx` does not exist.

- [ ] **Step 3: Configure Vitest and DOM cleanup**

Create `apps/web-console/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
```

Create `apps/web-console/src/test/setup.ts`:

```ts
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => cleanup());
```

Change the web-console test script to:

```json
{
  "scripts": {
    "test": "node --test --import tsx \"src/**/*.test.ts\" \"app/**/*.test.ts\" && vitest run"
  }
}
```

- [ ] **Step 4: Create a temporary minimal module only to prove runner wiring**

Create `apps/web-console/src/components/identity/forgot-password-form.tsx`:

```tsx
"use client";

export function ForgotPasswordForm() {
  return <label>Email address<input aria-label="Email address" /></label>;
}
```

- [ ] **Step 5: Verify the test runner GREEN**

Run:

```bash
pnpm --filter @booking-os/web-console test
```

Expected: existing node tests and the new Vitest smoke test pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web-console/vitest.config.ts apps/web-console/src/test/setup.ts apps/web-console/package.json apps/web-console/src/components/identity/identity-forms.test.tsx apps/web-console/src/components/identity/forgot-password-form.tsx
git commit -m "test(web-console): add identity component harness"
```

---

### Task 7: Migrate Activation and Reset Forms to React Hook Form

**Files:**
- Create: `apps/web-console/src/lib/identity/post-identity-command.ts`
- Create: `apps/web-console/src/components/identity/submission-message.tsx`
- Create: `apps/web-console/src/components/identity/password-command-form.tsx`
- Create: `apps/web-console/src/components/identity/activation-form.tsx`
- Create: `apps/web-console/src/components/identity/password-reset-form.tsx`
- Modify: `apps/web-console/src/components/identity/identity-forms.test.tsx`
- Modify: `apps/web-console/src/components/identity-forms.tsx`

**Interfaces:**
- Consumes: `passwordCommandFormSchema`, UI primitives, and existing `consumeIdentityTokenFragment`.
- Produces: `postIdentityCommand(path, body, signal?): Promise<Response>`, `PasswordCommandForm`, `ActivationForm`, and `PasswordResetForm`.

- [ ] **Step 1: Replace the smoke test with failing activation/reset behavior tests**

Extend `identity-forms.test.tsx` with:

```tsx
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";

import { ActivationForm } from "./activation-form.js";
import { PasswordResetForm } from "./password-reset-form.js";

beforeEach(() => {
  window.history.replaceState(null, "", "/activate#token=browser-selector.browser-verifier");
});

it("does not submit mismatched activation passwords and shows the stable validation copy", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();
  render(<ActivationForm />);

  await user.type(screen.getByLabelText("New password"), "Long-enough-password-123!");
  await user.type(screen.getByLabelText("Confirm new password"), "Different-password-123!");
  await user.click(screen.getByRole("button", { name: "Activate account" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("The passwords do not match.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("submits only the activation command fields after consuming the fragment", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  const user = userEvent.setup();
  render(<ActivationForm />);

  await user.type(screen.getByLabelText("New password"), "Long-enough-password-123!");
  await user.type(screen.getByLabelText("Confirm new password"), "Long-enough-password-123!");
  await user.click(screen.getByRole("button", { name: "Activate account" }));

  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/auth/activation/complete",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        scopeType: "platform",
        token: "browser-selector.browser-verifier",
        newPassword: "Long-enough-password-123!",
      }),
    }),
  );
  expect(window.location.hash).toBe("");
});

it("uses the reset endpoint for PasswordResetForm", async () => {
  window.history.replaceState(null, "", "/password/reset#token=browser-selector.browser-verifier");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 502 }));
  const user = userEvent.setup();
  render(<PasswordResetForm />);

  await user.type(screen.getByLabelText("New password"), "Long-enough-password-123!");
  await user.type(screen.getByLabelText("Confirm new password"), "Long-enough-password-123!");
  await user.click(screen.getByRole("button", { name: "Reset password" }));

  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/auth/password/reset",
    expect.objectContaining({ method: "POST" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't reset your password");
});
```

Add `@testing-library/jest-dom` only if `toHaveTextContent` is used; otherwise replace those assertions with `expect(element.textContent).toContain(...)`. Prefer the latter to keep the dependency set unchanged.

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
pnpm --filter @booking-os/web-console exec vitest run src/components/identity/identity-forms.test.tsx
```

Expected: FAIL because activation/reset modules do not exist and the temporary forgot-password implementation has no production behavior.

- [ ] **Step 3: Extract the HTTP command helper**

Create `apps/web-console/src/lib/identity/post-identity-command.ts`:

```ts
export async function postIdentityCommand(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal,
  });
}
```

- [ ] **Step 4: Implement shared submission message**

Create `apps/web-console/src/components/identity/submission-message.tsx`:

```tsx
import { Alert } from "@booking-os/ui/alert";

type SubmissionMessage =
  | Readonly<{ state: "idle" | "submitting" }>
  | Readonly<{ state: "success"; message: string }>
  | Readonly<{ state: "error"; message: string }>;

export function SubmissionMessage({ submission }: Readonly<{ submission: SubmissionMessage }>) {
  if (submission.state === "success") return <Alert role="status" variant="success">{submission.message}</Alert>;
  if (submission.state === "error") return <Alert variant="destructive">{submission.message}</Alert>;
  return null;
}

export type { SubmissionMessage as SubmissionMessageState };
```

- [ ] **Step 5: Implement the React Hook Form password command**

Create `apps/web-console/src/components/identity/password-command-form.tsx` with these exact responsibilities:

```tsx
"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  passwordCommandFormSchema,
  type PasswordCommandFormValues,
} from "@booking-os/contracts/identity";
import { Alert } from "@booking-os/ui/alert";
import { FormField } from "@booking-os/ui/form-field";
import { Input } from "@booking-os/ui/input";
import { SubmitButton } from "@booking-os/ui/submit-button";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { consumeIdentityTokenFragment } from "../../lib/identity/fragment-token";
import { postIdentityCommand } from "../../lib/identity/post-identity-command";
import { SubmissionMessage, type SubmissionMessageState } from "./submission-message";

const errorCopy = {
  PASSWORD_TOO_SHORT: "Use at least 12 characters.",
  PASSWORD_CONFIRMATION_MISMATCH: "The passwords do not match.",
  REQUIRED: "This field is required.",
} as const;

interface PasswordCommandFormProps {
  readonly action: "/api/auth/activation/complete" | "/api/auth/password/reset";
  readonly idleLabel: string;
  readonly pendingLabel: string;
  readonly successMessage: string;
  readonly failureMessage: string;
}
```

The implementation must:

1. Consume the URL fragment exactly once inside `useEffect` using the existing helper.
2. Store the consumed token only in component memory.
3. Configure `useForm<PasswordCommandFormValues>` with `zodResolver(passwordCommandFormSchema)` and empty default values.
4. Map schema error codes through `errorCopy` before passing them to `FormField`.
5. Submit exactly `{ scopeType: "platform", token, newPassword }` through `postIdentityCommand`.
6. Disable submit until fragment consumption finishes, and while token is missing or form submission is pending.
7. Render missing token as an `Alert` with the existing neutral copy.
8. Preserve success and failure copy passed by the wrapper.

- [ ] **Step 6: Implement endpoint wrappers and compatibility export**

Create `activation-form.tsx`:

```tsx
import { PasswordCommandForm } from "./password-command-form";

export function ActivationForm() {
  return (
    <PasswordCommandForm
      action="/api/auth/activation/complete"
      idleLabel="Activate account"
      pendingLabel="Submitting…"
      failureMessage="We couldn't activate your account. Request a new activation link and try again."
      successMessage="Your account has been activated."
    />
  );
}
```

Create `password-reset-form.tsx` with action `/api/auth/password/reset`, idle label `Reset password`, and the existing reset success/failure copy.

Replace `apps/web-console/src/components/identity-forms.tsx` with compatibility re-exports:

```ts
export { ActivationForm } from "./identity/activation-form";
export { ForgotPasswordForm } from "./identity/forgot-password-form";
export { PasswordResetForm } from "./identity/password-reset-form";
```

- [ ] **Step 7: Run focused tests to verify GREEN**

Run:

```bash
pnpm --filter @booking-os/contracts build
pnpm --filter @booking-os/ui build
pnpm --filter @booking-os/web-console exec vitest run src/components/identity/identity-forms.test.tsx
pnpm --filter @booking-os/web-console typecheck
```

Expected: activation/reset tests pass; typecheck exits `0`.

- [ ] **Step 8: Commit**

```bash
git add apps/web-console/src/lib/identity/post-identity-command.ts apps/web-console/src/components/identity apps/web-console/src/components/identity-forms.tsx
git commit -m "feat(web-console): migrate password commands to React Hook Form"
```

---

### Task 8: Implement Forgot-Password with React Hook Form

**Files:**
- Modify: `apps/web-console/src/components/identity/forgot-password-form.tsx`
- Modify: `apps/web-console/src/components/identity/identity-forms.test.tsx`

**Interfaces:**
- Consumes: `forgotPasswordFormSchema`, form presentation components, and `postIdentityCommand`.
- Produces: production `ForgotPasswordForm` preserving neutral enumeration-safe response copy.

- [ ] **Step 1: Add failing forgot-password behavior tests**

Add:

```tsx
it("rejects malformed email without sending a request", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);

  await user.type(screen.getByLabelText("Email address"), "not-an-email");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("Enter a valid email address.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("normalizes email and preserves the neutral success response", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);

  await user.type(screen.getByLabelText("Email address"), " User@Example.Test ");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));

  expect(globalThis.fetch).toHaveBeenCalledWith(
    "/api/auth/password/forgot",
    expect.objectContaining({
      body: JSON.stringify({ scopeType: "platform", email: "user@example.test" }),
    }),
  );
  const status = await screen.findByRole("status");
  expect(status.textContent).toContain("If an account matches that email, a reset link will be sent.");
});
```

- [ ] **Step 2: Run focused tests to verify RED**

Run:

```bash
pnpm --filter @booking-os/web-console exec vitest run src/components/identity/identity-forms.test.tsx
```

Expected: the temporary forgot-password component fails the new assertions.

- [ ] **Step 3: Implement the production forgot-password form**

Replace the temporary component with a React Hook Form implementation that:

```tsx
const form = useForm<ForgotPasswordFormValues>({
  resolver: zodResolver(forgotPasswordFormSchema),
  defaultValues: { email: "" },
});
```

Use `FormField`, `Input`, `SubmitButton`, and `SubmissionMessage`. Submit:

```ts
await postIdentityCommand("/api/auth/password/forgot", {
  scopeType: "platform",
  email: values.email,
});
```

Use these exact presentation mappings:

```ts
const errorCopy = {
  INVALID_EMAIL: "Enter a valid email address.",
  REQUIRED: "Email address is required.",
} as const;

const successMessage = "If an account matches that email, a reset link will be sent.";
const failureMessage = "We couldn't process your request. Try again shortly.";
```

Do not branch success copy based on account existence.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @booking-os/web-console exec vitest run src/components/identity/identity-forms.test.tsx
pnpm --filter @booking-os/web-console test
pnpm --filter @booking-os/web-console typecheck
```

Expected: component tests, existing node tests, and typecheck pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web-console/src/components/identity/forgot-password-form.tsx apps/web-console/src/components/identity/identity-forms.test.tsx
git commit -m "feat(web-console): migrate forgot password to React Hook Form"
```

---

### Task 9: Restyle Identity Pages and Lock the Browser Contract

**Files:**
- Modify: `apps/web-console/app/activate/page.tsx`
- Modify: `apps/web-console/app/password/forgot/page.tsx`
- Modify: `apps/web-console/app/password/reset/page.tsx`
- Modify: `e2e/identity.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: shared `Card` primitives and migrated identity forms.
- Produces: responsive Tailwind identity shell with unchanged accessible names, BFF payloads, and fragment-token behavior.

- [ ] **Step 1: Add failing browser assertions for client validation and shell semantics**

Add to `e2e/identity.spec.ts`:

```ts
test("identity forms validate in the browser before sending commands", async ({ page }) => {
  await page.goto(`${CONSOLE_BASE_URL}/activate#token=${encodeURIComponent(IDENTITY_TOKEN)}`);

  let commandRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/activation/complete")) commandRequests += 1;
  });

  await page.getByLabel("New password", { exact: true }).fill("short");
  await page.getByLabel("Confirm new password", { exact: true }).fill("different");
  await page.getByRole("button", { name: "Activate account" }).click();

  await expect(page.getByRole("alert")).toContainText(/12 characters|do not match/);
  expect(commandRequests).toBe(0);
});

test("identity shell remains keyboard accessible", async ({ page }) => {
  await page.goto(`${CONSOLE_BASE_URL}/password/forgot`);
  await expect(page.locator("main")).toHaveClass(/min-h-screen/);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address")).toBeFocused();
});
```

- [ ] **Step 2: Run identity Playwright to verify RED**

Run:

```bash
pnpm build
pnpm exec playwright test e2e/identity.spec.ts
```

Expected: new Tailwind shell-class assertion fails before page migration. Existing request behavior must remain green.

- [ ] **Step 3: Move page composition to shared cards and Tailwind classes**

Use this structure for each identity page, preserving existing heading text and IDs:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@booking-os/ui/card";

<main className="flex min-h-screen items-center justify-center bg-muted px-4 py-12">
  <Card className="w-full max-w-md">
    <CardHeader>
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Booking OS</p>
      <CardTitle id="activation-title">Activate your account</CardTitle>
      <CardDescription>Choose a secure password to finish activating your account.</CardDescription>
    </CardHeader>
    <CardContent>
      <ActivationForm />
    </CardContent>
  </Card>
</main>
```

Use equivalent copy and form component on forgot/reset pages. Add `className="grid gap-4"` to each form root and `className="w-full"` to submit buttons.

- [ ] **Step 4: Include frontend boundary verification in the foundation gate**

Update root `verify:foundation` so `pnpm verify:frontend-libraries` runs after architecture verification and before lint:

```json
{
  "scripts": {
    "verify:foundation": "pnpm check:ci && pnpm verify:architecture && pnpm verify:frontend-libraries && pnpm lint && pnpm typecheck && pnpm --filter @booking-os/api prisma:migrate:deploy && pnpm test && pnpm test:e2e:api && pnpm verify:migrations && pnpm build && pnpm test:e2e && pnpm verify:production-config"
  }
}
```

- [ ] **Step 5: Run focused browser verification GREEN**

Run:

```bash
pnpm build
pnpm exec playwright test e2e/identity.spec.ts
```

Expected: existing activation, forgot-password, and reset-password request tests pass; new client-validation and keyboard tests pass.

- [ ] **Step 6: Run the complete Plan 1 gate**

Run in this exact order:

```bash
pnpm check:ci
pnpm verify:architecture
pnpm verify:frontend-libraries
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:api
pnpm verify:migrations
pnpm build
pnpm test:e2e
pnpm verify:production-config
```

Expected: every command exits `0`. Record command output or CI run links in the PR description.

- [ ] **Step 7: Commit**

```bash
git add apps/web-console/app/activate/page.tsx apps/web-console/app/password/forgot/page.tsx apps/web-console/app/password/reset/page.tsx e2e/identity.spec.ts package.json
git commit -m "feat(web-console): apply shared UI foundation to identity"
```

---

## Completion Review Checklist

Before declaring Plan 1 complete, verify each item against code and fresh command output:

- [ ] All new dependencies are exact catalog versions and the lockfile is synchronized.
- [ ] No application source imports Axios directly.
- [ ] Tailwind compiles shared `packages/ui` source and semantic utilities.
- [ ] `packages/ui` exposes subpath imports for every component added by this plan.
- [ ] UI primitives support disabled, focus-visible, `aria-invalid`, and alert/status semantics.
- [ ] Identity schemas emit stable validation codes.
- [ ] Activation and reset tokens remain memory-only and are removed from the URL fragment before submission.
- [ ] Identity command request bodies are byte-for-byte equivalent in field names and values to the existing browser contract.
- [ ] Forgot-password keeps enumeration-safe neutral success copy.
- [ ] React Hook Form owns form values and submission state; no Zustand or TanStack Query state is introduced.
- [ ] Server layouts remain Server Components.
- [ ] Existing API, Mailpit, migration, architecture, and production gates remain green.
- [ ] Playwright confirms no request is sent for invalid client-side values.
- [ ] The final PR remains draft until review explicitly approves integration.

## Subsequent Plan Series

Plan 1 intentionally stops after the identity UI/forms vertical slice. Follow-up plans are written and reviewed separately so each remains independently testable:

1. **Plan 2 — Internationalization:** namespaced message catalogs, `next-intl`, storefront `/vi` and `/en`, console locale cookie, translated identity errors.
2. **Plan 3 — HTTP and Server State:** normalized API errors, Axios transport inside `@booking-os/api-client`, TanStack Query provider, MSW integration tests.
3. **Plan 4 — Client and URL State:** Zustand store factories, safe persistence, `nuqs` filters and pagination.
4. **Plan 5 — Booking Domain UI:** date/time adapter, DayPicker wrapper, TanStack Table, booking-flow vertical slice.
5. **Plan 6 — Quality Gates:** accessibility scans, dependency governance expansion, bundle budgets, visual regression, and CI enforcement.
