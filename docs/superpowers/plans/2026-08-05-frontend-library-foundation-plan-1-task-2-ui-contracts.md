# Plan 1 — Task 2: Shared UI Primitives and Identity Contracts

**Consumes:** exact dependencies and semantic tokens from Task 1.

**Produces:** UI subpath exports and `@booking-os/contracts/identity`.

## Task 2.1: Add UI and Form Presentation Primitives

**Files:**
- Create: `packages/ui/src/lib/cn.ts`
- Create: `packages/ui/src/components/button.tsx`
- Create: `packages/ui/src/components/input.tsx`
- Create: `packages/ui/src/components/label.tsx`
- Create: `packages/ui/src/components/card.tsx`
- Create: `packages/ui/src/components/alert.tsx`
- Create: `packages/ui/src/components/form-field.tsx`
- Create: `packages/ui/src/components/submit-button.tsx`
- Create: `packages/ui/tests/cn.test.ts`
- Create: `packages/ui/tests/primitives.test.tsx`
- Create: `packages/ui/tests/form-components.test.tsx`
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/vitest.config.ts`

**Interfaces:**
- `cn(...inputs: ClassValue[]): string`
- `FormField.children(props)` receives `{ "aria-describedby"?: string; "aria-invalid": boolean }`.
- `SubmitButton` receives `idleLabel`, `pendingLabel`, and optional `pending`.

- [ ] **Step 1: Write failing tests**

```ts
// packages/ui/tests/cn.test.ts
import { expect, it } from "vitest";
import { cn } from "../src/lib/cn.js";

it("resolves conditional and conflicting classes", () => {
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

it("renders accessible semantic primitives", () => {
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

it("links description and error IDs to the control", () => {
  const html = renderToStaticMarkup(
    <FormField id="password" label="Password" description="Use 12 characters" error="Too short">
      {(a11y) => <input id="password" {...a11y} />}
    </FormField>,
  );
  expect(html).toContain('aria-describedby="password-description password-error"');
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('role="alert"');
});

it("renders a disabled pending button", () => {
  const html = renderToStaticMarkup(<SubmitButton idleLabel="Save" pendingLabel="Saving…" pending />);
  expect(html).toContain("Saving…");
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain("disabled");
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @booking-os/ui test
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Implement the class utility**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Implement Button, Input, and Label**

```tsx
// button.tsx
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
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
  },
);

export interface ButtonProps extends ComponentProps<"button">, VariantProps<typeof buttonVariants> {}
export function Button({ className, variant, size, ref, ...props }: ButtonProps) {
  return <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
```

```tsx
// input.tsx
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";
export function Input({ className, ref, ...props }: ComponentProps<"input">) {
  return <input ref={ref} className={cn("h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground disabled:opacity-50 aria-invalid:border-destructive", className)} {...props} />;
}
```

```tsx
// label.tsx
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";
export function Label({ className, ref, ...props }: ComponentProps<"label">) {
  return <label ref={ref} className={cn("text-sm font-medium", className)} {...props} />;
}
```

- [ ] **Step 5: Implement Card and Alert**

```tsx
// card.tsx
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";
export const Card = ({ className, ...props }: ComponentProps<"div">) => <div className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", className)} {...props} />;
export const CardHeader = ({ className, ...props }: ComponentProps<"div">) => <div className={cn("flex flex-col gap-1.5 p-6", className)} {...props} />;
export const CardTitle = ({ className, ...props }: ComponentProps<"h1">) => <h1 className={cn("text-2xl font-semibold tracking-tight", className)} {...props} />;
export const CardDescription = ({ className, ...props }: ComponentProps<"p">) => <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
export const CardContent = ({ className, ...props }: ComponentProps<"div">) => <div className={cn("p-6 pt-0", className)} {...props} />;
```

```tsx
// alert.tsx
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/cn.js";
const alertVariants = cva("rounded-md border p-3 text-sm", {
  variants: { variant: {
    default: "bg-card text-card-foreground",
    destructive: "border-destructive/40 bg-destructive/10 text-destructive",
    success: "border-success/40 bg-success/10 text-foreground",
  } },
  defaultVariants: { variant: "default" },
});
export interface AlertProps extends ComponentProps<"div">, VariantProps<typeof alertVariants> {}
export function Alert({ className, variant, role = "alert", ...props }: AlertProps) {
  return <div role={role} data-variant={variant ?? "default"} className={cn(alertVariants({ variant }), className)} {...props} />;
}
```

- [ ] **Step 6: Implement FormField and SubmitButton**

```tsx
// form-field.tsx
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
  const a11y: ControlA11yProps = {
    ...(describedBy ? { "aria-describedby": describedBy } : {}),
    "aria-invalid": Boolean(error),
  };
  return <div className="grid gap-2">
    <Label htmlFor={id}>{label}</Label>
    {children(a11y)}
    {description ? <p id={`${id}-description`} className="text-sm text-muted-foreground">{description}</p> : null}
    {error ? <div id={`${id}-error`}><FieldError>{error}</FieldError></div> : null}
  </div>;
}
```

```tsx
// submit-button.tsx
import type { ButtonProps } from "./button.js";
import { Button } from "./button.js";
interface SubmitButtonProps extends Omit<ButtonProps, "children" | "type"> {
  idleLabel: string;
  pendingLabel: string;
  pending?: boolean;
}
export function SubmitButton({ idleLabel, pendingLabel, pending = false, disabled, ...props }: SubmitButtonProps) {
  return <Button type="submit" disabled={disabled || pending} aria-busy={pending} {...props}>{pending ? pendingLabel : idleLabel}</Button>;
}
```

- [ ] **Step 7: Add exact subpath exports**

```json
"./alert": { "types": "./dist/components/alert.d.ts", "import": "./src/components/alert.tsx" },
"./button": { "types": "./dist/components/button.d.ts", "import": "./src/components/button.tsx" },
"./card": { "types": "./dist/components/card.d.ts", "import": "./src/components/card.tsx" },
"./cn": { "types": "./dist/lib/cn.d.ts", "import": "./src/lib/cn.ts" },
"./form-field": { "types": "./dist/components/form-field.d.ts", "import": "./src/components/form-field.tsx" },
"./input": { "types": "./dist/components/input.d.ts", "import": "./src/components/input.tsx" },
"./label": { "types": "./dist/components/label.d.ts", "import": "./src/components/label.tsx" },
"./submit-button": { "types": "./dist/components/submit-button.d.ts", "import": "./src/components/submit-button.tsx" }
```

Set `packages/ui/vitest.config.ts` include to:

```ts
include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"]
```

- [ ] **Step 8: Run GREEN**

```bash
pnpm --filter @booking-os/ui test
pnpm --filter @booking-os/ui typecheck
pnpm --filter @booking-os/ui build
```

- [ ] **Step 9: Commit**

```bash
git add packages/ui/src packages/ui/tests packages/ui/package.json packages/ui/vitest.config.ts
git commit -m "feat(ui): add identity UI and form primitives"
```

## Task 2.2: Add Stable Identity Schemas

**Files:**
- Create: `packages/contracts/src/identity/forms.ts`
- Create: `packages/contracts/src/identity/index.ts`
- Create: `packages/contracts/tests/identity-forms.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/package.json`

- [ ] **Step 1: Write failing schema tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { forgotPasswordFormSchema, passwordCommandFormSchema } from "../src/identity/index.js";

test("normalizes email and emits stable codes", () => {
  assert.deepEqual(forgotPasswordFormSchema.parse({ email: " User@Example.Test " }), { email: "user@example.test" });
  const empty = forgotPasswordFormSchema.safeParse({ email: "" });
  assert.equal(empty.success, false);
  if (!empty.success) assert.equal(empty.error.issues[0]?.message, "REQUIRED");
  const malformed = forgotPasswordFormSchema.safeParse({ email: "bad" });
  assert.equal(malformed.success, false);
  if (!malformed.success) assert.equal(malformed.error.issues[0]?.message, "INVALID_EMAIL");
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

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @booking-os/contracts test
```

Expected: FAIL because `src/identity/index.ts` does not exist.

- [ ] **Step 3: Implement schemas**

```ts
// packages/contracts/src/identity/forms.ts
import { z } from "zod";

export const forgotPasswordFormSchema = z.object({
  email: z.string().trim().min(1, { error: "REQUIRED" }).toLowerCase().email({ error: "INVALID_EMAIL" }),
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

Add to root source index:

```ts
export * from "./identity/index.js";
```

Add package export:

```json
"./identity": { "types": "./dist/identity/index.d.ts", "import": "./dist/identity/index.js" }
```

- [ ] **Step 4: Run GREEN**

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
