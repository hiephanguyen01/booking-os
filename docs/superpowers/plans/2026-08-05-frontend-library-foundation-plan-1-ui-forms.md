# Frontend Library Foundation Plan 1: UI and Identity Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish exact dependency governance, Tailwind CSS, shared UI/form primitives, typed identity schemas, and React Hook Form integration through the existing activation, forgot-password, and reset-password vertical slice.

**Architecture:** Tailwind compilation belongs to `apps/web-console`; semantic tokens and reusable presentation components belong to `packages/ui`; Zod identity schemas belong to `packages/contracts`; identity request orchestration remains in `apps/web-console`. Existing Server Component layouts, BFF routes, request bodies, origin checks, CSRF behavior, and fragment-token removal remain unchanged.

**Tech Stack:** pnpm 10, Turborepo 2.10.7, Next.js 16.2.12, React 19.2.8, TypeScript 5.9.3, Tailwind CSS 4.3.3, React Hook Form 7.83.0, Zod 4.4.3, Vitest 4.1.10, React Testing Library 16.3.2, Playwright 1.62.0.

## Global Constraints

- Use Node.js `>=22.0.0 <25.0.0` and pnpm `>=10.0.0 <11.0.0`.
- Keep Next.js `16.2.12`, React/React DOM `19.2.8`, TypeScript `5.9.3`, Biome `2.5.6`, and existing PostCSS override `8.5.18`.
- Pin new dependencies exactly in the workspace catalog.
- Server Components remain the default; only interactive identity form modules use `"use client"`.
- Do not add Axios, TanStack Query, Zustand, `nuqs`, `next-intl`, date libraries, table libraries, or unused UI primitives in this plan.
- Do not change identity endpoint URLs or request shapes.
- Do not persist activation/reset tokens, passwords, email addresses, session data, or permissions in the browser.
- Validation schemas emit stable codes; presentation code maps those codes to current English copy until the i18n plan.
- Generated OpenAPI files are never edited manually.
- Every task follows RED → GREEN → focused verification → commit.
- The implementation PR remains draft until an explicit integration decision.

## Locked File Map

```text
apps/web-console/
├── app/
│   ├── activate/page.tsx
│   ├── password/forgot/page.tsx
│   ├── password/reset/page.tsx
│   └── globals.css
├── postcss.config.mjs
├── vitest.config.ts
├── src/components/identity/
│   ├── activation-form.tsx
│   ├── forgot-password-form.tsx
│   ├── password-command-form.tsx
│   ├── password-reset-form.tsx
│   ├── submission-message.tsx
│   ├── identity-forms.test.tsx
│   └── index.ts
├── src/lib/identity/post-identity-command.ts
└── src/test/setup.ts

packages/contracts/
├── src/identity/forms.ts
├── src/identity/index.ts
└── tests/identity-forms.test.ts

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
├── src/styles/{tokens,base,index}.css
└── tests/{cn,primitives,form-components}.test.*

scripts/architecture/
├── frontend-library-boundaries.mjs
├── frontend-library-boundaries.test.mjs
└── frontend-styles.test.mjs
```

---

### Task 1: Pin Dependencies and Enforce Frontend Boundaries

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `packages/contracts/package.json`
- Modify: `packages/api-client/package.json`
- Modify: `packages/ui/package.json`
- Modify: `apps/web-console/package.json`
- Create: `scripts/architecture/frontend-library-boundaries.mjs`
- Create: `scripts/architecture/frontend-library-boundaries.test.mjs`
- Modify: `pnpm-lock.yaml` via pnpm

**Interfaces:**
- Produces: `verifyFrontendLibraryBoundaries(rootDir): Promise<readonly string[]>`
- Produces: root command `pnpm verify:frontend-libraries`

- [ ] **Step 1: Write the failing boundary tests**

```js
// scripts/architecture/frontend-library-boundaries.test.mjs
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

test("accepts exact catalog versions and permitted form imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "booking-os-frontend-"));
  await writeFixture(root, "pnpm-workspace.yaml", [
    "catalog:",
    "  tailwindcss: 4.3.3",
    "  react-hook-form: 7.83.0",
    "  zod: 4.4.3",
    "",
  ].join("\n"));
  await writeFixture(root, "apps/web-console/src/form.tsx", 'import { useForm } from "react-hook-form";\nexport { useForm };\n');
  assert.deepEqual(await verifyFrontendLibraryBoundaries(root), []);
});

test("rejects ranges and direct axios imports in applications", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "booking-os-frontend-"));
  await writeFixture(root, "pnpm-workspace.yaml", "catalog:\n  tailwindcss: ^4.3.3\n");
  await writeFixture(root, "apps/web-console/src/bad.ts", 'import axios from "axios";\nexport default axios;\n');
  const violations = await verifyFrontendLibraryBoundaries(root);
  assert.equal(violations.some((item) => item.includes("exact version")), true);
  assert.equal(violations.some((item) => item.includes("direct axios import")), true);
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test scripts/architecture/frontend-library-boundaries.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `frontend-library-boundaries.mjs`.

- [ ] **Step 3: Implement the verifier**

```js
// scripts/architecture/frontend-library-boundaries.mjs
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const IGNORED = new Set([".git", ".next", ".turbo", "dist", "node_modules"]);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(absolute)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }
  return files;
}

function isExactVersion(value) {
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);
}

export async function verifyFrontendLibraryBoundaries(rootDir) {
  const violations = [];
  const workspace = await readFile(path.join(rootDir, "pnpm-workspace.yaml"), "utf8").catch(() => "");
  let insideCatalog = false;
  for (const line of workspace.split("\n")) {
    if (line === "catalog:") {
      insideCatalog = true;
      continue;
    }
    if (insideCatalog && line && !line.startsWith("  ")) insideCatalog = false;
    if (!insideCatalog) continue;
    const match = line.match(/^\s{2}["']?(.+?)["']?:\s*["']?([^"']+)["']?\s*$/);
    if (match && !isExactVersion(match[2])) {
      violations.push(`catalog dependency ${match[1]} must use an exact version; received ${match[2]}`);
    }
  }

  for (const app of ["apps/web-console", "apps/web-storefront"]) {
    for (const file of await collectSourceFiles(path.join(rootDir, app))) {
      const source = await readFile(file, "utf8");
      if (/from\s+["']axios["']|import\s*\(["']axios["']\)/.test(source)) {
        violations.push(`${path.relative(rootDir, file)} contains a direct axios import`);
      }
    }
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = await verifyFrontendLibraryBoundaries(process.cwd());
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  }
}
```

- [ ] **Step 4: Add exact catalog versions**

Add to `pnpm-workspace.yaml` under `catalog:`:

```yaml
  "@hookform/resolvers": 5.5.7
  "@tailwindcss/postcss": 4.3.3
  "@testing-library/dom": 10.4.1
  "@testing-library/react": 16.3.2
  "@testing-library/user-event": 14.6.1
  class-variance-authority: 0.7.1
  clsx: 2.1.1
  jsdom: 29.1.1
  postcss: 8.5.18
  react-hook-form: 7.83.0
  tailwind-merge: 3.6.0
  tailwindcss: 4.3.3
  vitest: 4.1.10
  zod: 4.4.3
```

Apply package ownership exactly:

```text
packages/contracts dependencies:
  zod: catalog:

packages/api-client dependencies:
  zod: catalog:        # replace direct 4.4.3

packages/ui dependencies:
  class-variance-authority: catalog:
  clsx: catalog:
  tailwind-merge: catalog:

packages/ui devDependencies:
  vitest: catalog:     # replace direct 4.1.10

apps/web-console dependencies:
  @hookform/resolvers: catalog:
  react-hook-form: catalog:

apps/web-console devDependencies:
  @tailwindcss/postcss: catalog:
  @testing-library/dom: catalog:
  @testing-library/react: catalog:
  @testing-library/user-event: catalog:
  jsdom: catalog:
  postcss: catalog:
  tailwindcss: catalog:
  vitest: catalog:
```

Add root script:

```json
"verify:frontend-libraries": "node scripts/architecture/frontend-library-boundaries.mjs"
```

- [ ] **Step 5: Refresh lockfile and verify GREEN**

```bash
pnpm install --lockfile-only
node --test scripts/architecture/frontend-library-boundaries.test.mjs
pnpm verify:frontend-libraries
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml packages/contracts/package.json packages/api-client/package.json packages/ui/package.json apps/web-console/package.json scripts/architecture/frontend-library-boundaries.mjs scripts/architecture/frontend-library-boundaries.test.mjs
git commit -m "build(frontend): govern UI and form dependencies"
```

---

### Task 2: Add Tailwind Compilation and Semantic Tokens

**Files:**
- Create: `apps/web-console/postcss.config.mjs`
- Create: `packages/ui/src/styles/tokens.css`
- Create: `packages/ui/src/styles/base.css`
- Create: `packages/ui/src/styles/index.css`
- Modify: `packages/ui/package.json`
- Replace: `apps/web-console/app/globals.css`
- Create: `scripts/architecture/frontend-styles.test.mjs`

**Interfaces:**
- Produces: `@booking-os/ui/styles.css`
- Produces: `bg-background`, `text-foreground`, `bg-primary`, `text-destructive`, `border-border`

- [ ] **Step 1: Write the failing style contract**

```js
// scripts/architecture/frontend-styles.test.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(file, "utf8");

test("console configures Tailwind and scans shared UI", async () => {
  const [postcss, globals] = await Promise.all([
    read("apps/web-console/postcss.config.mjs"),
    read("apps/web-console/app/globals.css"),
  ]);
  assert.match(postcss, /@tailwindcss\/postcss/);
  assert.match(globals, /@import\s+["']tailwindcss["']/);
  assert.match(globals, /@import\s+["']@booking-os\/ui\/styles\.css["']/);
  assert.match(globals, /@source\s+["'][^"']*packages\/ui\/src/);
});

test("shared styles expose required semantic tokens", async () => {
  const tokens = await read("packages/ui/src/styles/tokens.css");
  for (const token of ["--background", "--foreground", "--primary", "--destructive", "--border", "--ring"]) {
    assert.equal(tokens.includes(token), true, `missing ${token}`);
  }
});
```

- [ ] **Step 2: Verify RED**

```bash
node --test scripts/architecture/frontend-styles.test.mjs
```

Expected: FAIL with `ENOENT` for `postcss.config.mjs`.

- [ ] **Step 3: Implement PostCSS and shared styles**

```js
// apps/web-console/postcss.config.mjs
export default { plugins: { "@tailwindcss/postcss": {} } };
```

```css
/* packages/ui/src/styles/tokens.css */
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
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-md: var(--radius);
}
```

```css
/* packages/ui/src/styles/base.css */
* { border-color: var(--border); }
body {
  background: var(--background);
  color: var(--foreground);
  font-family: Arial, Helvetica, sans-serif;
  text-rendering: optimizeLegibility;
}
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
```

```css
/* packages/ui/src/styles/index.css */
@import "./tokens.css";
@import "./base.css";
```

Add export:

```json
"./styles.css": "./src/styles/index.css"
```

Replace console globals:

```css
@import "tailwindcss";
@import "@booking-os/ui/styles.css";
@source "../../../packages/ui/src/**/*.{ts,tsx}";

html, body { min-height: 100%; }
body { margin: 0; }
```

- [ ] **Step 4: Verify GREEN**

```bash
node --test scripts/architecture/frontend-styles.test.mjs
pnpm --filter @booking-os/web-console build
```

Expected: both exit `0`.

- [ ] **Step 5: Commit**

```bash
git add apps/web-console/postcss.config.mjs apps/web-console/app/globals.css packages/ui/src/styles packages/ui/package.json scripts/architecture/frontend-styles.test.mjs
git commit -m "feat(ui): establish Tailwind semantic tokens"
```

---

### Task 3: Add Shared UI and Form Presentation Primitives

**Files:**
- Create: `packages/ui/src/lib/cn.ts`
- Create: `packages/ui/src/components/{button,input,label,card,alert,form-field,submit-button}.tsx`
- Create: `packages/ui/tests/cn.test.ts`
- Create: `packages/ui/tests/primitives.test.tsx`
- Create: `packages/ui/tests/form-components.test.tsx`
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/vitest.config.ts`

**Interfaces:**
- Produces: `cn`, `Button`, `Input`, `Label`, `Card*`, `Alert`, `FormField`, `FieldError`, `SubmitButton`
- `FormField` child signature: `(props: { "aria-describedby"?: string; "aria-invalid": boolean }) => ReactNode`

- [ ] **Step 1: Write failing tests**

```ts
// packages/ui/tests/cn.test.ts
import { describe, expect, it } from "vitest";
import { cn } from "../src/lib/cn.js";
it("merges conditional classes and Tailwind conflicts", () => {
  expect(cn("px-2", false && "hidden", ["py-1", "px-4"])).toBe("py-1 px-4");
});
```

```tsx
// packages/ui/tests/primitives.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { Alert } from "../src/components/alert.js";
import { Button } from "../src/components/button.js";
import { Card, CardContent, CardTitle } from "../src/components/card.js";
import { Input } from "../src/components/input.js";
import { Label } from "../src/components/label.js";

it("renders accessible identity primitives", () => {
  const html = renderToStaticMarkup(<>
    <Label htmlFor="email">Email address</Label>
    <Input id="email" aria-invalid />
    <Button type="submit">Continue</Button>
    <Card><CardTitle>Title</CardTitle><CardContent><Alert variant="destructive">Error</Alert></CardContent></Card>
  </>);
  expect(html).toContain('for="email"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain("bg-primary");
  expect(html).toContain('role="alert"');
});
```

```tsx
// packages/ui/tests/form-components.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FormField } from "../src/components/form-field.js";
import { SubmitButton } from "../src/components/submit-button.js";

it("links descriptions and errors to a control", () => {
  const html = renderToStaticMarkup(
    <FormField id="password" label="Password" description="Use 12 characters" error="Too short">
      {(a11y) => <input id="password" {...a11y} />}
    </FormField>,
  );
  expect(html).toContain('aria-describedby="password-description password-error"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('role="alert"');
});

it("renders pending submit state", () => {
  const html = renderToStaticMarkup(<SubmitButton idleLabel="Save" pendingLabel="Saving…" pending />);
  expect(html).toContain("Saving…");
  expect(html).toContain('aria-busy="true"');
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/ui test
```

Expected: FAIL because modules do not exist.

- [ ] **Step 3: Implement utilities and primitives**

```ts
// packages/ui/src/lib/cn.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
export function cn(...inputs: ClassValue[]): string { return twMerge(clsx(inputs)); }
```

```tsx
// packages/ui/src/components/button.tsx
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

const variants = cva("inline-flex items-center justify-center rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: {
      default: "bg-primary text-primary-foreground hover:opacity-90",
      secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
      destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
      ghost: "hover:bg-muted",
    },
    size: { default: "h-10 px-4 py-2", sm: "h-9 px-3", lg: "h-11 px-6" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof variants> {}
export function Button({ className, variant, size, ref, ...props }: ButtonProps) {
  return <button ref={ref} className={cn(variants({ variant, size }), className)} {...props} />;
}
```

```tsx
// packages/ui/src/components/input.tsx
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";
export function Input({ className, ref, ...props }: ComponentProps<"input">) {
  return <input ref={ref} className={cn("h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground disabled:opacity-50 aria-invalid:border-destructive", className)} {...props} />;
}
```

```tsx
// packages/ui/src/components/label.tsx
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";
export function Label({ className, ref, ...props }: ComponentProps<"label">) {
  return <label ref={ref} className={cn("text-sm font-medium", className)} {...props} />;
}
```

```tsx
// packages/ui/src/components/card.tsx
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";
export const Card = ({ className, ...props }: ComponentProps<"div">) => <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />;
export const CardHeader = ({ className, ...props }: ComponentProps<"div">) => <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />;
export const CardTitle = ({ className, ...props }: ComponentProps<"h1">) => <h1 className={cn("text-2xl font-semibold tracking-tight", className)} {...props} />;
export const CardDescription = ({ className, ...props }: ComponentProps<"p">) => <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
export const CardContent = ({ className, ...props }: ComponentProps<"div">) => <div className={cn("p-6 pt-0", className)} {...props} />;
```

```tsx
// packages/ui/src/components/alert.tsx
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";
const variants = cva("rounded-md border p-3 text-sm", {
  variants: { variant: {
    default: "bg-card text-card-foreground",
    destructive: "border-destructive/40 bg-destructive/10 text-destructive",
    success: "border-success/40 bg-success/10 text-foreground",
  } },
  defaultVariants: { variant: "default" },
});
export interface AlertProps extends ComponentProps<"div">, VariantProps<typeof variants> {}
export function Alert({ className, variant, role = "alert", ...props }: AlertProps) {
  return <div role={role} data-variant={variant ?? "default"} className={cn(variants({ variant }), className)} {...props} />;
}
```

```tsx
// packages/ui/src/components/form-field.tsx
import type { ReactNode } from "react";
import { Label } from "./label.js";

type ControlA11yProps = { "aria-describedby"?: string; "aria-invalid": boolean };
interface FormFieldProps {
  id: string;
  label: string;
  description?: string;
  error?: string;
  children: (props: ControlA11yProps) => ReactNode;
}
export function FieldError({ children }: Readonly<{ children: ReactNode }>) {
  return <p className="text-sm text-destructive" role="alert">{children}</p>;
}
export function FormField({ id, label, description, error, children }: FormFieldProps) {
  const describedBy = [description && `${id}-description`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
  return <div className="grid gap-2">
    <Label htmlFor={id}>{label}</Label>
    {children({ "aria-describedby": describedBy, "aria-invalid": Boolean(error) })}
    {description ? <p id={`${id}-description`} className="text-sm text-muted-foreground">{description}</p> : null}
    {error ? <div id={`${id}-error`}><FieldError>{error}</FieldError></div> : null}
  </div>;
}
```

```tsx
// packages/ui/src/components/submit-button.tsx
import type { ButtonProps } from "./button.js";
import { Button } from "./button.js";
interface Props extends Omit<ButtonProps, "children" | "type"> {
  idleLabel: string;
  pendingLabel: string;
  pending?: boolean;
}
export function SubmitButton({ idleLabel, pendingLabel, pending = false, disabled, ...props }: Props) {
  return <Button type="submit" disabled={disabled || pending} aria-busy={pending} {...props}>{pending ? pendingLabel : idleLabel}</Button>;
}
```

- [ ] **Step 4: Add package exports and test inclusion**

Add subpath exports for `./alert`, `./button`, `./card`, `./cn`, `./form-field`, `./input`, `./label`, and `./submit-button`, each pointing types to `dist` and imports to `src` following the existing package pattern.

Set Vitest include:

```ts
include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
```

- [ ] **Step 5: Verify GREEN**

```bash
pnpm --filter @booking-os/ui test
pnpm --filter @booking-os/ui typecheck
pnpm --filter @booking-os/ui build
```

Expected: all exit `0`.

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src packages/ui/tests packages/ui/package.json packages/ui/vitest.config.ts
git commit -m "feat(ui): add identity UI and form primitives"
```

---

### Task 4: Add Stable Identity Form Schemas

**Files:**
- Create: `packages/contracts/src/identity/forms.ts`
- Create: `packages/contracts/src/identity/index.ts`
- Create: `packages/contracts/tests/identity-forms.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`

**Interfaces:**
- Produces: `forgotPasswordFormSchema`, `passwordCommandFormSchema`
- Produces: `ForgotPasswordFormValues`, `PasswordCommandFormValues`
- Produces: `@booking-os/contracts/identity`

- [ ] **Step 1: Write failing tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { forgotPasswordFormSchema, passwordCommandFormSchema } from "../src/identity/index.js";

test("normalizes valid email and emits INVALID_EMAIL", () => {
  assert.deepEqual(forgotPasswordFormSchema.parse({ email: " User@Example.Test " }), { email: "user@example.test" });
  const result = forgotPasswordFormSchema.safeParse({ email: "bad" });
  assert.equal(result.success, false);
  if (!result.success) assert.equal(result.error.issues[0]?.message, "INVALID_EMAIL");
});

test("emits stable password codes", () => {
  const short = passwordCommandFormSchema.safeParse({ newPassword: "short", confirmation: "short" });
  assert.equal(short.success, false);
  if (!short.success) assert.equal(short.error.issues[0]?.message, "PASSWORD_TOO_SHORT");

  const mismatch = passwordCommandFormSchema.safeParse({ newPassword: "Long-enough-password-123!", confirmation: "Different-password-123!" });
  assert.equal(mismatch.success, false);
  if (!mismatch.success) {
    const issue = mismatch.error.issues.at(-1);
    assert.equal(issue?.message, "PASSWORD_CONFIRMATION_MISMATCH");
    assert.deepEqual(issue?.path, ["confirmation"]);
  }
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/contracts test
```

Expected: missing identity module.

- [ ] **Step 3: Implement schemas and exports**

```ts
// packages/contracts/src/identity/forms.ts
import { z } from "zod";
export const forgotPasswordFormSchema = z.object({
  email: z.string().trim().toLowerCase().email({ error: "INVALID_EMAIL" }),
});
export const passwordCommandFormSchema = z.object({
  newPassword: z.string().min(12, { error: "PASSWORD_TOO_SHORT" }),
  confirmation: z.string().min(1, { error: "REQUIRED" }),
}).refine((value) => value.newPassword === value.confirmation, {
  path: ["confirmation"],
  error: "PASSWORD_CONFIRMATION_MISMATCH",
});
export type ForgotPasswordFormValues = z.infer<typeof forgotPasswordFormSchema>;
export type PasswordCommandFormValues = z.infer<typeof passwordCommandFormSchema>;
```

```ts
// packages/contracts/src/identity/index.ts
export * from "./forms.js";
```

Add `export * from "./identity/index.js";` to root source index and add package export:

```json
"./identity": { "types": "./dist/identity/index.d.ts", "import": "./dist/identity/index.js" }
```

- [ ] **Step 4: Verify GREEN**

```bash
pnpm --filter @booking-os/contracts test
pnpm --filter @booking-os/contracts typecheck
pnpm --filter @booking-os/contracts build
```

- [ ] **Step 5: Commit**

```bash
git add packages/contracts/src packages/contracts/tests packages/contracts/package.json
git commit -m "feat(contracts): add identity form schemas"
```

---

### Task 5: Configure Web Console Component Tests

**Files:**
- Create: `apps/web-console/vitest.config.ts`
- Create: `apps/web-console/src/test/setup.ts`
- Create: `apps/web-console/src/test/component-harness.test.tsx`
- Modify: `apps/web-console/package.json`

**Interfaces:**
- Produces: JSDOM component runner included in the workspace `test` command.

- [ ] **Step 1: Write a failing harness test**

```tsx
// apps/web-console/src/test/component-harness.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
it("renders React components in JSDOM", () => {
  render(<label>Email address<input aria-label="Email address" /></label>);
  expect(screen.getByLabelText("Email address")).toBeTruthy();
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/web-console exec vitest run
```

Expected: missing config/dependency environment or no matching configured test command.

- [ ] **Step 3: Add config and cleanup**

```ts
// apps/web-console/vitest.config.ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:3002/" } },
    include: ["src/**/*.test.tsx"],
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
  },
});
```

```ts
// apps/web-console/src/test/setup.ts
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(() => cleanup());
```

Change workspace script:

```json
"test": "node --test --import tsx \"src/**/*.test.ts\" \"app/**/*.test.ts\" && vitest run"
```

- [ ] **Step 4: Verify GREEN**

```bash
pnpm --filter @booking-os/web-console test
```

Expected: existing node tests and JSDOM harness pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web-console/vitest.config.ts apps/web-console/src/test apps/web-console/package.json
git commit -m "test(web-console): add component test harness"
```

---

### Task 6: Migrate Activation and Reset Password Forms

**Files:**
- Create: `apps/web-console/src/lib/identity/post-identity-command.ts`
- Create: `apps/web-console/src/components/identity/submission-message.tsx`
- Create: `apps/web-console/src/components/identity/password-command-form.tsx`
- Create: `apps/web-console/src/components/identity/activation-form.tsx`
- Create: `apps/web-console/src/components/identity/password-reset-form.tsx`
- Create: `apps/web-console/src/components/identity/index.ts`
- Create: `apps/web-console/src/components/identity/identity-forms.test.tsx`
- Replace: `apps/web-console/src/components/identity-forms.tsx`

**Interfaces:**
- `postIdentityCommand(path, body, signal?): Promise<Response>`
- `PasswordCommandFormProps.action` is activation-complete or password-reset only.

- [ ] **Step 1: Write failing behavior tests**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { ActivationForm } from "./activation-form.js";
import { PasswordResetForm } from "./password-reset-form.js";

beforeEach(() => window.history.replaceState(null, "", "/activate#token=browser-selector.browser-verifier"));

it("blocks mismatched passwords without a request", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();
  render(<ActivationForm />);
  const submit = screen.getByRole("button", { name: "Activate account" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  await user.type(screen.getByLabelText("New password"), "Long-enough-password-123!");
  await user.type(screen.getByLabelText("Confirm new password"), "Different-password-123!");
  await user.click(submit);
  expect((await screen.findByRole("alert")).textContent).toContain("The passwords do not match.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("submits only platform token and newPassword", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  const user = userEvent.setup();
  render(<ActivationForm />);
  const submit = screen.getByRole("button", { name: "Activate account" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  await user.type(screen.getByLabelText("New password"), "Long-enough-password-123!");
  await user.type(screen.getByLabelText("Confirm new password"), "Long-enough-password-123!");
  await user.click(submit);
  expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/activation/complete", expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ scopeType: "platform", token: "browser-selector.browser-verifier", newPassword: "Long-enough-password-123!" }),
  }));
  expect(window.location.hash).toBe("");
});

it("uses reset endpoint and failure copy", async () => {
  window.history.replaceState(null, "", "/password/reset#token=browser-selector.browser-verifier");
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 502 }));
  const user = userEvent.setup();
  render(<PasswordResetForm />);
  const submit = screen.getByRole("button", { name: "Reset password" });
  await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
  await user.type(screen.getByLabelText("New password"), "Long-enough-password-123!");
  await user.type(screen.getByLabelText("Confirm new password"), "Long-enough-password-123!");
  await user.click(submit);
  expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/password/reset", expect.objectContaining({ method: "POST" }));
  expect((await screen.findByRole("alert")).textContent).toContain("We couldn't reset your password");
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/web-console exec vitest run src/components/identity/identity-forms.test.tsx
```

Expected: missing form modules.

- [ ] **Step 3: Implement command helper and submission state**

```ts
// apps/web-console/src/lib/identity/post-identity-command.ts
export function postIdentityCommand(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(path, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
}
```

```tsx
// submission-message.tsx
import { Alert } from "@booking-os/ui/alert";
export type SubmissionState =
  | { state: "idle" | "submitting" }
  | { state: "success"; message: string }
  | { state: "error"; message: string };
export function SubmissionMessage({ value }: Readonly<{ value: SubmissionState }>) {
  if (value.state === "success") return <Alert role="status" variant="success">{value.message}</Alert>;
  if (value.state === "error") return <Alert variant="destructive">{value.message}</Alert>;
  return null;
}
```

- [ ] **Step 4: Implement full password command form**

```tsx
"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { passwordCommandFormSchema, type PasswordCommandFormValues } from "@booking-os/contracts/identity";
import { Alert } from "@booking-os/ui/alert";
import { FormField } from "@booking-os/ui/form-field";
import { Input } from "@booking-os/ui/input";
import { SubmitButton } from "@booking-os/ui/submit-button";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { consumeIdentityTokenFragment } from "../../lib/identity/fragment-token";
import { postIdentityCommand } from "../../lib/identity/post-identity-command";
import { SubmissionMessage, type SubmissionState } from "./submission-message";

const copy = {
  PASSWORD_TOO_SHORT: "Use at least 12 characters.",
  PASSWORD_CONFIRMATION_MISMATCH: "The passwords do not match.",
  REQUIRED: "This field is required.",
} as const;
const messageFor = (value: unknown) => typeof value === "string" ? copy[value as keyof typeof copy] : undefined;

type Props = {
  action: "/api/auth/activation/complete" | "/api/auth/password/reset";
  idleLabel: string;
  pendingLabel: string;
  successMessage: string;
  failureMessage: string;
};

export function PasswordCommandForm({ action, idleLabel, pendingLabel, successMessage, failureMessage }: Props) {
  const consumed = useRef(false);
  const [tokenState, setTokenState] = useState<{ ready: boolean; token: string | null }>({ ready: false, token: null });
  const [submission, setSubmission] = useState<SubmissionState>({ state: "idle" });
  const form = useForm<PasswordCommandFormValues>({
    resolver: zodResolver(passwordCommandFormSchema),
    defaultValues: { newPassword: "", confirmation: "" },
  });

  useEffect(() => {
    if (consumed.current) return;
    consumed.current = true;
    setTokenState({ ready: true, token: consumeIdentityTokenFragment(window.location, window.history) });
  }, []);

  const onSubmit = form.handleSubmit(async (values) => {
    if (!tokenState.token) {
      setSubmission({ state: "error", message: "This link is invalid or incomplete. Request a new link and try again." });
      return;
    }
    setSubmission({ state: "submitting" });
    try {
      const response = await postIdentityCommand(action, { scopeType: "platform", token: tokenState.token, newPassword: values.newPassword });
      setSubmission(response.ok ? { state: "success", message: successMessage } : { state: "error", message: failureMessage });
    } catch {
      setSubmission({ state: "error", message: failureMessage });
    }
  });

  const missingToken = tokenState.ready && !tokenState.token;
  return <form className="grid gap-4" onSubmit={onSubmit} noValidate>
    <FormField id={`${action}-new-password`} label="New password" description="Use at least 12 characters." error={messageFor(form.formState.errors.newPassword?.message)}>
      {(a11y) => <Input id={`${action}-new-password`} type="password" autoComplete="new-password" {...form.register("newPassword")} {...a11y} />}
    </FormField>
    <FormField id={`${action}-confirmation`} label="Confirm new password" error={messageFor(form.formState.errors.confirmation?.message)}>
      {(a11y) => <Input id={`${action}-confirmation`} type="password" autoComplete="new-password" {...form.register("confirmation")} {...a11y} />}
    </FormField>
    <SubmitButton className="w-full" idleLabel={idleLabel} pendingLabel={pendingLabel} pending={form.formState.isSubmitting || submission.state === "submitting"} disabled={!tokenState.ready || missingToken} />
    {missingToken ? <Alert variant="destructive">This link is invalid or incomplete. Request a new link and try again.</Alert> : null}
    <SubmissionMessage value={submission} />
  </form>;
}
```

- [ ] **Step 5: Add exact wrappers and exports**

```tsx
// activation-form.tsx
import { PasswordCommandForm } from "./password-command-form";
export function ActivationForm() {
  return <PasswordCommandForm action="/api/auth/activation/complete" idleLabel="Activate account" pendingLabel="Submitting…" successMessage="Your account has been activated." failureMessage="We couldn't activate your account. Request a new activation link and try again." />;
}
```

```tsx
// password-reset-form.tsx
import { PasswordCommandForm } from "./password-command-form";
export function PasswordResetForm() {
  return <PasswordCommandForm action="/api/auth/password/reset" idleLabel="Reset password" pendingLabel="Submitting…" successMessage="Your password has been reset." failureMessage="We couldn't reset your password. Request a new reset link and try again." />;
}
```

```ts
// identity/index.ts
export { ActivationForm } from "./activation-form";
export { ForgotPasswordForm } from "./forgot-password-form";
export { PasswordResetForm } from "./password-reset-form";
```

Replace compatibility file:

```ts
export { ActivationForm, ForgotPasswordForm, PasswordResetForm } from "./identity";
```

- [ ] **Step 6: Verify GREEN**

```bash
pnpm --filter @booking-os/contracts build
pnpm --filter @booking-os/ui build
pnpm --filter @booking-os/web-console exec vitest run src/components/identity/identity-forms.test.tsx
pnpm --filter @booking-os/web-console typecheck
```

- [ ] **Step 7: Commit**

```bash
git add apps/web-console/src/lib/identity/post-identity-command.ts apps/web-console/src/components/identity apps/web-console/src/components/identity-forms.tsx
git commit -m "feat(web-console): migrate password commands to React Hook Form"
```

---

### Task 7: Migrate Forgot Password Form

**Files:**
- Create: `apps/web-console/src/components/identity/forgot-password-form.tsx`
- Modify: `apps/web-console/src/components/identity/identity-forms.test.tsx`

**Interfaces:**
- Preserves: `POST /api/auth/password/forgot`
- Preserves body: `{ scopeType: "platform", email }`
- Preserves enumeration-safe success copy.

- [ ] **Step 1: Add failing tests**

```tsx
import { ForgotPasswordForm } from "./forgot-password-form.js";

it("rejects malformed email without requesting the BFF", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch");
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);
  await user.type(screen.getByLabelText("Email address"), "not-an-email");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Enter a valid email address.");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("normalizes email and renders neutral success", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 202 }));
  const user = userEvent.setup();
  render(<ForgotPasswordForm />);
  await user.type(screen.getByLabelText("Email address"), " User@Example.Test ");
  await user.click(screen.getByRole("button", { name: "Send reset link" }));
  expect(globalThis.fetch).toHaveBeenCalledWith("/api/auth/password/forgot", expect.objectContaining({
    body: JSON.stringify({ scopeType: "platform", email: "user@example.test" }),
  }));
  expect((await screen.findByRole("status")).textContent).toContain("If an account matches that email, a reset link will be sent.");
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm --filter @booking-os/web-console exec vitest run src/components/identity/identity-forms.test.tsx
```

- [ ] **Step 3: Implement full form**

```tsx
"use client";
import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordFormSchema, type ForgotPasswordFormValues } from "@booking-os/contracts/identity";
import { FormField } from "@booking-os/ui/form-field";
import { Input } from "@booking-os/ui/input";
import { SubmitButton } from "@booking-os/ui/submit-button";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { postIdentityCommand } from "../../lib/identity/post-identity-command";
import { SubmissionMessage, type SubmissionState } from "./submission-message";

export function ForgotPasswordForm() {
  const [submission, setSubmission] = useState<SubmissionState>({ state: "idle" });
  const form = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(forgotPasswordFormSchema),
    defaultValues: { email: "" },
  });
  const onSubmit = form.handleSubmit(async (values) => {
    setSubmission({ state: "submitting" });
    try {
      const response = await postIdentityCommand("/api/auth/password/forgot", { scopeType: "platform", email: values.email });
      setSubmission(response.ok
        ? { state: "success", message: "If an account matches that email, a reset link will be sent." }
        : { state: "error", message: "We couldn't process your request. Try again shortly." });
    } catch {
      setSubmission({ state: "error", message: "We couldn't process your request. Try again shortly." });
    }
  });
  const error = form.formState.errors.email?.message === "INVALID_EMAIL" ? "Enter a valid email address." : undefined;
  return <form className="grid gap-4" onSubmit={onSubmit} noValidate>
    <FormField id="forgot-password-email" label="Email address" error={error}>
      {(a11y) => <Input id="forgot-password-email" type="email" autoComplete="email" {...form.register("email")} {...a11y} />}
    </FormField>
    <SubmitButton className="w-full" idleLabel="Send reset link" pendingLabel="Sending…" pending={form.formState.isSubmitting || submission.state === "submitting"} />
    <SubmissionMessage value={submission} />
  </form>;
}
```

- [ ] **Step 4: Verify GREEN**

```bash
pnpm --filter @booking-os/web-console test
pnpm --filter @booking-os/web-console typecheck
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-console/src/components/identity/forgot-password-form.tsx apps/web-console/src/components/identity/identity-forms.test.tsx
git commit -m "feat(web-console): migrate forgot password to React Hook Form"
```

---

### Task 8: Apply Shared UI to Identity Pages and Run Full Gates

**Files:**
- Modify: `apps/web-console/app/activate/page.tsx`
- Modify: `apps/web-console/app/password/forgot/page.tsx`
- Modify: `apps/web-console/app/password/reset/page.tsx`
- Modify: `e2e/identity.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Preserves all current accessible headings, labels, button names, and request assertions.
- Produces responsive shared Card shells.

- [ ] **Step 1: Add failing browser assertions**

```ts
test("invalid activation values do not send a command", async ({ page }) => {
  await page.goto(`${CONSOLE_BASE_URL}/activate#token=${encodeURIComponent(IDENTITY_TOKEN)}`);
  let commands = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/api/auth/activation/complete")) commands += 1;
  });
  await page.getByLabel("New password", { exact: true }).fill("short");
  await page.getByLabel("Confirm new password", { exact: true }).fill("different");
  await page.getByRole("button", { name: "Activate account" }).click();
  await expect(page.getByRole("alert")).toContainText(/12 characters|do not match/);
  expect(commands).toBe(0);
});

test("identity shell supports keyboard entry", async ({ page }) => {
  await page.goto(`${CONSOLE_BASE_URL}/password/forgot`);
  await expect(page.locator("main")).toHaveClass(/min-h-screen/);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address")).toBeFocused();
});
```

- [ ] **Step 2: Verify RED**

```bash
pnpm build
pnpm exec playwright test e2e/identity.spec.ts
```

Expected: shell class assertion fails; existing identity request tests remain green.

- [ ] **Step 3: Replace each page with exact shared shell**

Activation:

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@booking-os/ui/card";
import { ActivationForm } from "../../src/components/identity-forms";
export default function ActivatePage() {
  return <main className="flex min-h-screen items-center justify-center bg-muted px-4 py-12">
    <Card className="w-full max-w-md"><CardHeader>
      <p className="text-sm font-semibold uppercase tracking-[0.2em] text-primary">Booking OS</p>
      <CardTitle id="activation-title">Activate your account</CardTitle>
      <CardDescription>Choose a secure password to finish activating your account.</CardDescription>
    </CardHeader><CardContent><ActivationForm /></CardContent></Card>
  </main>;
}
```

Forgot password uses the same shell with:

```text
CardTitle: Forgot your password?
CardDescription: Enter your email address and we'll send a reset link if an account matches.
Form: ForgotPasswordForm
```

Reset password uses:

```text
CardTitle: Reset your password
CardDescription: Choose a new secure password for your account.
Form: PasswordResetForm
```

Keep current heading text exactly where existing Playwright selectors depend on it.

- [ ] **Step 4: Add boundary command to full foundation gate**

Insert `pnpm verify:frontend-libraries` after `pnpm verify:architecture` in `verify:foundation`.

- [ ] **Step 5: Run focused browser GREEN**

```bash
pnpm build
pnpm exec playwright test e2e/identity.spec.ts
```

- [ ] **Step 6: Run complete fresh verification**

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

Expected: every command exits `0`; record fresh output or CI links before claiming completion.

- [ ] **Step 7: Commit**

```bash
git add apps/web-console/app/activate/page.tsx apps/web-console/app/password/forgot/page.tsx apps/web-console/app/password/reset/page.tsx e2e/identity.spec.ts package.json
git commit -m "feat(web-console): apply shared UI foundation to identity"
```

---

## Completion Review Checklist

- [ ] New dependencies are exact catalog values and lockfile is synchronized.
- [ ] Tailwind compiles shared UI sources.
- [ ] UI components use semantic tokens and subpath imports.
- [ ] `FormField` connects description/error IDs to controls.
- [ ] Identity schemas emit stable codes.
- [ ] Activation/reset tokens remain memory-only and are removed from URL fragments.
- [ ] Activation/reset request bodies remain `{ scopeType, token, newPassword }`.
- [ ] Forgot-password body remains `{ scopeType, email }` and success copy remains neutral.
- [ ] React Hook Form owns form/submission state; no alternate global state library is introduced.
- [ ] Existing layouts remain Server Components.
- [ ] Invalid browser values produce no command request.
- [ ] All fresh gates in Task 8 pass.
- [ ] Implementation PR remains draft.

## Subsequent Plan Series

1. **Plan 2 — Internationalization:** namespaced catalogs, `next-intl`, storefront `/vi` and `/en`, console locale cookie, translated identity errors.
2. **Plan 3 — HTTP and Server State:** normalized errors, Axios inside `@booking-os/api-client`, TanStack Query, MSW.
3. **Plan 4 — Client and URL State:** Zustand store factories, safe persistence, `nuqs`.
4. **Plan 5 — Booking Domain UI:** date/time adapter, DayPicker, TanStack Table, booking-flow vertical slice.
5. **Plan 6 — Quality Gates:** accessibility scans, bundle budgets, visual regression, expanded dependency policy.
