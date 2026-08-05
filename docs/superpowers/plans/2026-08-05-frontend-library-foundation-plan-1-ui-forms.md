# Frontend Library Foundation Plan 1: UI and Identity Forms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish exact dependency governance, Tailwind CSS, shared UI/form primitives, typed identity schemas, and React Hook Form integration through the existing activation, forgot-password, and reset-password vertical slice.

**Architecture:** Tailwind compilation belongs to `apps/web-console`; semantic tokens and reusable presentation components belong to `packages/ui`; Zod schemas belong to `packages/contracts`; identity request orchestration remains in `apps/web-console`. Existing Server Component layouts, BFF routes, origin checks, request bodies, CSRF behavior, and fragment-token removal remain unchanged.

**Tech Stack:** pnpm 10, Turborepo 2.10.7, Next.js 16.2.12, React 19.2.8, TypeScript 5.9.3, Tailwind CSS 4.3.3, React Hook Form 7.83.0, Zod 4.4.3, Vitest 4.1.10, React Testing Library 16.3.2, Playwright 1.62.0.

## Global Constraints

- Use Node.js `>=22.0.0 <25.0.0` and pnpm `>=10.0.0 <11.0.0`.
- Keep Next.js `16.2.12`, React/React DOM `19.2.8`, TypeScript `5.9.3`, Biome `2.5.6`, and the repository PostCSS override `8.5.18`.
- Pin every new dependency exactly in the workspace catalog.
- Server Components remain the default; only interactive identity form modules use `"use client"`.
- Do not add Axios, TanStack Query, Zustand, `nuqs`, `next-intl`, date libraries, table libraries, or unused UI primitives in this plan.
- Do not change identity endpoint URLs or request shapes.
- Do not persist activation/reset tokens, passwords, email addresses, session data, or permissions in the browser.
- Validation schemas emit stable codes; presentation maps them to current English copy until Plan 2.
- Generated OpenAPI files are never edited manually.
- Every task follows RED → GREEN → focused verification → commit.
- The implementation PR remains draft until an explicit integration decision.

## Execution Order

Read [`2026-08-05-frontend-library-foundation-plan-1-self-review-amendments.md`](./2026-08-05-frontend-library-foundation-plan-1-self-review-amendments.md) first. Its two command corrections are normative and override the matching task steps.

Then execute these task files in order:

1. [`2026-08-05-frontend-library-foundation-plan-1-task-1-dependencies-tailwind.md`](./2026-08-05-frontend-library-foundation-plan-1-task-1-dependencies-tailwind.md)
   - Exact dependency catalog.
   - Frontend import/version boundary gate.
   - Tailwind/PostCSS compilation and semantic tokens.
2. [`2026-08-05-frontend-library-foundation-plan-1-task-2-ui-contracts.md`](./2026-08-05-frontend-library-foundation-plan-1-task-2-ui-contracts.md)
   - Shared UI/form primitives and subpath exports.
   - Stable Zod identity form contracts.
3. [`2026-08-05-frontend-library-foundation-plan-1-task-3-identity-forms.md`](./2026-08-05-frontend-library-foundation-plan-1-task-3-identity-forms.md)
   - JSDOM component harness.
   - React Hook Form migration for activation, reset, and forgot-password.
   - Fragment-token and request-body compatibility tests.
4. [`2026-08-05-frontend-library-foundation-plan-1-task-4-pages-gates.md`](./2026-08-05-frontend-library-foundation-plan-1-task-4-pages-gates.md)
   - Tailwind/shared-card page composition.
   - Playwright validation and keyboard contracts.
   - Complete fresh repository verification.

Each task file includes exact files, produced interfaces, RED command, implementation, GREEN command, and commit checkpoint. A later task may consume only interfaces explicitly produced by an earlier task.

## Locked File Map

```text
apps/web-console/
├── app/{activate,password/forgot,password/reset}/page.tsx
├── app/globals.css
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
└── src/test/{setup.ts,component-harness.test.tsx}

packages/contracts/
├── src/identity/{forms,index}.ts
└── tests/identity-forms.test.ts

packages/ui/
├── src/components/{alert,button,card,form-field,input,label,submit-button}.tsx
├── src/lib/cn.ts
├── src/styles/{tokens,base,index}.css
└── tests/{cn,primitives,form-components}.test.*

scripts/architecture/
├── frontend-library-boundaries.mjs
├── frontend-library-boundaries.test.mjs
└── frontend-styles.test.mjs
```

## Completion Review Checklist

- [ ] New dependencies are exact catalog values and the lockfile is synchronized.
- [ ] Tailwind compiles shared `packages/ui` source.
- [ ] UI components use semantic tokens and subpath exports.
- [ ] `FormField` connects description/error IDs to controls.
- [ ] Identity schemas emit stable codes.
- [ ] Activation/reset tokens remain memory-only and are removed from URL fragments.
- [ ] Activation/reset bodies remain `{ scopeType, token, newPassword }`.
- [ ] Forgot-password body remains `{ scopeType, email }` and success copy remains neutral.
- [ ] React Hook Form owns form and submission state; no global state library is introduced.
- [ ] Existing layouts remain Server Components.
- [ ] Invalid browser values produce no command request.
- [ ] Every fresh gate in Task 4 passes.
- [ ] Implementation PR remains draft.

## Subsequent Plan Series

1. **Plan 2 — Internationalization:** namespaced catalogs, `next-intl`, storefront `/vi` and `/en`, console locale cookie, translated identity errors.
2. **Plan 3 — HTTP and Server State:** normalized errors, Axios inside `@booking-os/api-client`, TanStack Query, MSW.
3. **Plan 4 — Client and URL State:** Zustand store factories, safe persistence, `nuqs`.
4. **Plan 5 — Booking Domain UI:** date/time adapter, DayPicker, TanStack Table, booking-flow vertical slice.
5. **Plan 6 — Quality Gates:** accessibility scans, bundle budgets, visual regression, expanded dependency policy.
