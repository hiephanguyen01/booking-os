# Frontend Library Foundation Design

- **Status:** Approved for implementation planning
- **Date:** 2026-08-05
- **Repository:** `hiephanguyen01/booking-os`
- **Base commit:** `a4ade4e8291caf597b0ecf257beb5c4d8556a78d`
- **Design branch:** `docs/frontend-library-foundation-design`

## 1. Purpose

Booking OS already has Next.js applications, a shared UI package, an i18n package, a generated API client, and working identity journeys. This design defines how commonly adopted frontend libraries will be integrated without weakening the existing knowledge-first architecture, server/client boundaries, generated contracts, security controls, or CI gates.

The target is a production-grade frontend foundation that gives teams reusable UI primitives, typed forms, internationalization, normalized HTTP behavior, server-state caching, feature-scoped client state, URL state, date/time handling, accessibility, and test infrastructure.

## 2. Scope

This design covers:

- Tailwind CSS and a shared design-token system.
- shadcn/ui-derived components backed by Radix primitives.
- React Hook Form and Zod-based form validation.
- Axios as a client transport inside `@booking-os/api-client` only.
- TanStack Query for interactive server state.
- Zustand for feature-scoped client UI state.
- `nuqs` for URL-backed filter, sort, pagination, and search state.
- `next-intl` for App Router internationalization.
- Date/time and calendar libraries suitable for booking workflows.
- Shared providers, performance budgets, security constraints, testing, and rollout order.

## 3. Non-goals

The foundation will not:

- Replace Server Components with client rendering.
- Replace native `fetch` in Server Components and route handlers with Axios.
- Store session credentials, access tokens, reset tokens, or personal booking data in browser persistence.
- Introduce Redux Toolkit, Formik, Moment.js, XState, a rich-text editor, upload dashboard, virtual lists, drag-and-drop, or charting before a real use case exists.
- Build a tenant translation CMS.
- Translate tenant-authored service content automatically.
- Change backend authorization or tenancy rules.

## 4. Current context

The repository contains:

- `apps/web-storefront` using Next.js App Router.
- `apps/web-console` using Next.js App Router and working identity pages.
- `packages/ui` with a small shared component surface.
- `packages/i18n` with Vietnamese and English messages and locale helpers.
- `packages/api-client` with generated OpenAPI types/client code and Zod.

The new foundation must extend these packages instead of bypassing them.

## 5. Architectural principles

1. **Server Components remain the default.** Client boundaries are introduced only for interactive behavior.
2. **Generated API contracts remain the source of truth.** Generated files are never edited manually.
3. **Each state category has one owner.**
4. **Shared components live in `packages/ui`; domain orchestration lives in apps or domain packages.**
5. **Displayed text comes from i18n messages, not backend exception strings.**
6. **Tenant and authorization decisions are always revalidated by the server.**
7. **Libraries are added through real vertical slices, not as unused scaffolding.**
8. **Every rollout stage starts with RED tests and ends with existing gates green.**

## 6. State ownership model

| State type | Owner |
| --- | --- |
| Server-rendered data | Next.js Server Components and native `fetch` |
| Interactive server cache | TanStack Query |
| Form values and validation | React Hook Form + Zod |
| Shared client UI state | Zustand |
| Search, filters, sort, pagination | `nuqs` |
| Small local interaction state | React `useState` / `useReducer` |
| Authentication and authorization truth | Server session and API |

Rules:

- API data is not copied into Zustand as a second long-lived cache.
- Complete form state is not copied into Zustand.
- TanStack Query does not manage dialog state, wizard steps, or sidebar state.
- Shareable and reloadable filters belong in the URL through `nuqs`.
- Session and permissions are never trusted solely from client state.

## 7. Library set

### 7.1 Foundation libraries

UI and styling:

- `tailwindcss`
- `@tailwindcss/postcss`
- shadcn/ui-generated source components
- Radix UI primitives required by selected components
- `class-variance-authority`
- `clsx`
- `tailwind-merge`
- `lucide-react`
- `sonner`

Forms and validation:

- `react-hook-form`
- `@hookform/resolvers`
- `zod`

Data and state:

- `axios`
- `@tanstack/react-query`
- `zustand`
- `nuqs`

Internationalization:

- `next-intl`

Date, time, calendar, and tables:

- `date-fns`
- `@date-fns/tz`
- `@daypicker/react`
- `@tanstack/react-table`

Testing:

- `msw`
- `@testing-library/react`
- `@testing-library/user-event`
- `@axe-core/playwright`

### 7.2 Deferred libraries

Add only when a feature requires them:

- `@dnd-kit/react` and helpers for drag-and-drop.
- `@tanstack/react-virtual` for very large lists.
- Uppy packages for direct-to-object-storage uploads.
- XState for workflows that exceed a clear finite-state complexity threshold.
- `libphonenumber-js` for international phone normalization.

## 8. Shared UI system

### 8.1 Package responsibility

`packages/ui` becomes the shared design system. It owns:

- Semantic design tokens.
- Tailwind-compatible shared styles.
- Accessible primitive components.
- Component variants.
- Common feedback, form, and data-display components.
- Shared UI utilities such as `cn`.

It does not own domain components such as `BookingCalendar`, `ServiceEditor`, or `TenantSwitcher` unless those components later become truly cross-application and domain-stable.

### 8.2 Proposed structure

```text
packages/ui/
├── src/
│   ├── components/
│   │   ├── primitives/
│   │   ├── forms/
│   │   ├── feedback/
│   │   └── data-display/
│   ├── hooks/
│   ├── lib/
│   │   └── cn.ts
│   └── styles/
│       ├── tokens.css
│       ├── base.css
│       └── utilities.css
├── components.json
└── package.json
```

### 8.3 First component set

The first rollout contains only components needed by identity and near-term booking work:

- Button
- Input
- Label
- Card
- Badge
- Alert
- Skeleton
- Dialog
- DropdownMenu
- Select
- Separator
- Tooltip
- FormField
- FieldError
- SubmitButton
- Toast integration

### 8.4 Tokens and theming

Components use semantic tokens such as:

- `background`
- `foreground`
- `card`
- `primary`
- `secondary`
- `muted`
- `accent`
- `destructive`
- `success`
- `warning`
- `border`
- `input`
- `ring`
- `radius`

Components must not hard-code brand color classes when a semantic token exists. Tenant branding is applied through validated CSS variables, never dynamically constructed Tailwind class names.

### 8.5 Component standards

Every shared interactive component must support:

- Ref forwarding where applicable.
- Disabled behavior.
- Keyboard interaction.
- Accessible name and `aria-*` support.
- Visible focus states.
- Responsive sizing.
- Dark-mode-compatible tokens.
- Controlled extension through `className`.
- Stable CVA variants when variants are required.

### 8.6 Export strategy

Use subpath exports to avoid importing the entire package through a single broad barrel:

```ts
import {Button} from "@booking-os/ui/button";
import {Dialog} from "@booking-os/ui/dialog";
```

## 9. Forms with React Hook Form and Zod

### 9.1 Responsibility

React Hook Form owns form field state, touched/dirty state, submission state, and field-level errors. Zod owns deterministic validation rules and stable error codes.

Schemas live in `packages/contracts` or a domain package, not inside UI components.

### 9.2 Error model

Schemas and APIs return stable machine-readable codes such as:

- `REQUIRED`
- `INVALID_EMAIL`
- `PASSWORD_TOO_SHORT`
- `PASSWORD_CONFIRMATION_MISMATCH`

The UI translates these codes through `next-intl`. Schemas do not contain final Vietnamese or English prose.

### 9.3 Form flow

```text
React Hook Form
→ Zod resolver
→ typed API mutation
→ normalized ApiError
→ setError / form alert / toast / success state
```

Field errors are mapped with `form.setError`. Business errors appear in a form-level alert. System errors show a localized fallback and request ID.

### 9.4 Multi-step forms

React Hook Form continues to own values. Zustand may own navigation state such as the current step and navigation guards. Form values must not be duplicated into Zustand merely to move between steps.

## 10. HTTP and API client design

### 10.1 Two transport paths

Server path:

- Native `fetch`.
- Next.js cache and revalidation support.
- Cookie and request-context forwarding.
- Zod validation.
- Shared error normalization.

Client path:

- One configured Axios instance inside `packages/api-client`.
- Request metadata and CSRF handling.
- AbortSignal support.
- Shared error normalization.
- TanStack Query integration.

### 10.2 Boundary rule

Application components must not import Axios directly. They call typed functions exported from `@booking-os/api-client`.

### 10.3 Request metadata

The transport may attach:

- `X-Request-Id`
- `X-CSRF-Token`
- `X-Tenant-Id` when the authenticated context permits it
- `Accept-Language`

It must not read an access token from local storage or allow a component to invent an authoritative tenant context.

### 10.4 Normalized error shape

```ts
interface ApiError {
  code: string;
  message: string;
  status: number;
  requestId?: string;
  fieldErrors?: Record<string, string[]>;
  retryable: boolean;
  cause?: unknown;
}
```

The UI does not display the raw backend `message`. It translates `code`, falls back to `errors.UNKNOWN`, and preserves `requestId` for support.

### 10.5 Retry rules

Automatic retry may apply to safe reads and transient failures such as network timeout, `502`, `503`, and `504`. Mutations do not retry automatically unless the API explicitly supports idempotency.

Activation, password reset, payment confirmation, and booking creation are not automatically retried without an idempotency guarantee.

## 11. TanStack Query design

TanStack Query is used only for interactive server data that benefits from caching, invalidation, polling, optimistic updates, or background refresh.

Appropriate use cases:

- Availability and booking calendars.
- Paginated dashboard tables.
- Service search and filtering.
- Payment-status polling.
- Optimistic mutations with rollback.

Inappropriate use cases:

- Static metadata.
- Data rendered once in a Server Component.
- Dialog state or form state.

Query keys are produced by feature factories rather than ad hoc arrays. Optimistic updates must implement `onMutate`, rollback in `onError`, and final invalidation in `onSettled`.

A browser `QueryClient` is created once with `useState(createBrowserQueryClient)` and is not recreated during render.

## 12. Zustand design

### 12.1 Use cases

Zustand manages feature-scoped client UI state such as:

- Console sidebar state.
- Command palette state.
- Booking wizard step.
- Calendar display mode.
- Bulk selection.
- Temporary editor layout and preview state.

### 12.2 Store boundaries

Create multiple focused stores rather than a global `useAppStore`.

Suggested stores:

```text
apps/web-console/src/stores/
├── console-shell-store.ts
├── booking-editor-store.ts
└── service-editor-store.ts

apps/web-storefront/src/stores/
├── booking-flow-store.ts
└── storefront-preference-store.ts
```

Request- or route-dependent stores are created by factories and provided near the route. They are not module-level singletons.

### 12.3 Persistence

Persistence is limited to safe preferences:

- Theme preference.
- Sidebar collapsed state.
- Calendar display mode.
- Locale preference.

Persistence must never include:

- Session or access tokens.
- CSRF tokens.
- Activation/reset tokens.
- Customer email or phone.
- Booking personal data.
- Payment data.
- Authoritative permission state.

Persisted stores require a version, migration strategy, and `partialize` allowlist.

## 13. URL state with `nuqs`

Search text, filters, sorting, and pagination that users should be able to bookmark, reload, or share belong in the URL.

Examples:

```text
/bookings?page=2&status=confirmed&staff=staff_123
/services?q=hair&sort=price
```

Zustand must not duplicate this state.

## 14. Internationalization

### 14.1 Routing decision

Storefront:

- Localized URLs use `/vi/...` and `/en/...`.
- `/` redirects to `/vi`.
- Unsupported locale segments return `404`.

Console:

- URLs do not contain locale prefixes.
- Locale is resolved from `BOOKING_OS_LOCALE`, saved user preference, `Accept-Language`, then Vietnamese fallback.

### 14.2 `packages/i18n`

`packages/i18n` owns:

- Supported locale definitions.
- Default locale.
- Locale normalization.
- Namespaced message catalogs.
- Typed message-key support.
- Date, number, and currency formatting helpers.
- Message parity validation between Vietnamese and English.

Next.js-specific request and routing integration remains inside each app.

### 14.3 Message structure

Messages are split by namespace:

- `common`
- `navigation`
- `identity`
- `booking`
- `service`
- `staff`
- `customer`
- `payment`
- `validation`
- `errors`

Message keys represent meaning, not source-language prose.

### 14.4 Server-first messages

Server Components use server translation APIs. Client providers receive only the namespaces needed by the active route, avoiding shipment of the entire message catalog.

### 14.5 Errors and validation

API and validation layers return stable codes. The presentation layer translates them. Production falls back safely for a missing key and emits an observability event; tests fail for missing required translations.

### 14.6 Tenant content

Tenant-authored service names and descriptions are domain content, not UI messages. A later localized-content model may support Vietnamese and English variants, with fallback to the tenant default language.

## 15. Date, time, calendar, and table handling

Booking OS stores instants in UTC and stores tenant time zones as IANA identifiers such as `Asia/Ho_Chi_Minh`.

Presentation rules:

- Database: UTC instant.
- API: ISO-8601.
- Business calculations: explicit tenant time zone.
- UI formatting: locale plus tenant/user time zone.

`date-fns` and `@date-fns/tz` provide date operations. `@daypicker/react` provides the shared date-picker/calendar primitive. TanStack Table provides headless table behavior styled through `packages/ui`.

Calendar and table libraries must be wrapped behind Booking OS components or adapters so a later library change does not spread through the application.

## 16. Provider composition

### 16.1 Strategy

Use global foundation providers plus route-scoped feature providers.

Global client providers may include:

- `NextIntlClientProvider`
- `QueryClientProvider`
- Sonner toaster
- Console shell store provider where globally required

Feature providers include:

- Booking flow store provider.
- Service editor store provider.
- Calendar interaction provider.

Zustand stores that are not globally required must not be mounted at the root.

### 16.2 Storefront

The locale layout resolves locale, messages, and tenant theme on the server, then passes safe presentation data into a client provider boundary. The booking-flow store is mounted only under booking routes.

### 16.3 Console

The root layout resolves locale and session server-side. Only a safe session view containing identifiers and presentation-safe permission data may cross into the client. Tokens and cookies never become provider props.

## 17. Performance design

### 17.1 Client boundaries

`"use client"` is limited to interactive forms, tables, calendars, dialogs, query hooks, and Zustand consumers. Root layouts and most pages remain Server Components.

### 17.2 Lazy loading

Heavy feature components such as calendars, editors, charts, drag-and-drop surfaces, and upload dashboards are dynamically imported when introduced. `ssr: false` is used only for components that truly require browser APIs.

### 17.3 Bundle boundaries

Shared packages expose subpaths so consumers import only the component or adapter they need. The implementation will add bundle analysis and budget checks before declaring the foundation complete.

Initial target budgets:

- Simple public route: at most 170 KB gzip initial client JavaScript.
- Identity route: at most 200 KB gzip initial client JavaScript.
- LCP: at most 2.5 seconds at p75.
- CLS: at most 0.1.
- INP: at most 200 ms at p75.

Budgets are guardrails and must not justify removing required accessibility or validation behavior.

## 18. Security design

- Session cookies remain `HttpOnly`, `Secure`, and appropriately `SameSite`.
- Axios is isolated to the API-client package.
- Client state never becomes an authorization boundary.
- CSRF handling remains consistent with the existing identity implementation.
- Passwords, reset tokens, activation tokens, cookies, payment secrets, and authorization headers are never logged.
- Activation and reset tokens are removed from the visible URL as soon as the current security design permits.
- Important mutations prevent double submission and use idempotency keys when supported.
- File uploads, when introduced, are revalidated server-side for type, size, and policy.
- Dependency updates are grouped into reviewable PRs and major upgrades are not automatically merged.

## 19. Error boundaries and observability

Each app provides root and route-level `error.tsx`, `global-error.tsx`, and `not-found.tsx` boundaries as appropriate.

Error surfaces:

- Display localized messages.
- Offer retry only when safe.
- Preserve request IDs.
- Never expose stack traces in production.
- Send redacted structured errors to the observability adapter.

Business and validation errors stay inside the feature and do not automatically escalate to the global error boundary.

## 20. Testing strategy

### 20.1 Unit tests

`packages/ui`:

- Variants.
- Disabled and focus behavior.
- Keyboard behavior.
- Ref forwarding.
- Accessible naming.

`packages/i18n`:

- Vietnamese/English key parity.
- Locale normalization.
- Missing-key behavior.
- Plural, date, number, and currency formatting.

`packages/api-client`:

- Axios configuration and interceptors.
- CSRF and locale headers.
- AbortSignal forwarding.
- Error normalization.
- Retry decisions.
- Query-key factories.
- Secret redaction.

Zustand:

- Initial state.
- Selector updates.
- Reset behavior.
- Persistence allowlist.
- Migration behavior.

Forms/contracts:

- Valid inputs.
- Boundary conditions.
- Cross-field validation.
- Stable error codes.

### 20.2 Integration tests

MSW tests exercise the complete client boundary:

```text
React Hook Form
+ Zod
+ API client
+ TanStack mutation
+ translated error
```

Required scenarios include `400`, `401`, `403`, `409`, `410`, `429`, and `500` behavior.

### 20.3 Browser tests

Playwright validates:

- `/` redirect to `/vi`.
- Storefront locale switching.
- Console cookie locale switching.
- Identity forms migrated to the new UI/form stack.
- No request for locally invalid form data.
- Double-submit prevention.
- Booking wizard navigation state.
- No persistence of sensitive data.
- Keyboard-only journeys.
- Axe accessibility checks.
- Mobile viewport behavior.
- Time-zone edge cases.

### 20.4 Visual regression

Visual regression is limited to high-value shared components and critical routes, including buttons, form states, dialogs, error states, identity pages, booking flow, and the console shell.

## 21. CI and architecture gates

The implementation adds gates for:

- i18n message validation.
- UI accessibility tests.
- Bundle budgets.
- Dependency policy.
- No direct Axios imports outside `packages/api-client`.
- No direct primitive imports where a Booking OS wrapper exists.
- No request-dependent Zustand singleton.
- No manual generated-client edits.
- Existing lint, typecheck, unit, API E2E, Playwright, architecture, migration, OpenAPI, production-config, and security gates remaining green.

## 22. Rollout order

### Stage 1 — Dependency governance

- Add catalog entries and exact version pins.
- Add dependency and import-boundary tests before libraries are used.

### Stage 2 — Tailwind and UI foundation

- Add Tailwind and design tokens.
- Add `cn` and initial shared primitives.
- Migrate one identity page as the vertical slice.

### Stage 3 — React Hook Form

- Add Zod resolver and shared form components.
- Migrate activation, forgot-password, and reset-password forms.
- Normalize field errors.

### Stage 4 — Internationalization

- Migrate flat messages to namespaced catalogs.
- Add `next-intl`.
- Add storefront locale routes and console locale cookie.
- Localize the identity vertical slice.

### Stage 5 — HTTP and server state

- Add Axios transport and normalized errors.
- Add TanStack Query provider.
- Add one real interactive query/mutation use case.
- Add MSW integration tests.

### Stage 6 — Zustand and URL state

- Add console shell and booking-flow stores through factories.
- Add `nuqs` for filters and pagination.
- Add persistence allowlist and migration tests.

### Stage 7 — Domain UI

- Add TanStack Table adapters.
- Add date/time adapters and DayPicker wrapper.
- Apply them to booking, service, staff, and customer features as those plans begin.

Each stage is a small PR or an explicit stacked PR, with RED/GREEN evidence. The complete library set is not introduced in one monolithic change.

## 23. Acceptance criteria

The frontend library foundation is complete when:

1. Identity pages use Tailwind and components from `@booking-os/ui`.
2. Identity forms use React Hook Form and Zod.
3. Storefront supports `/vi` and `/en`, with `/` redirecting to `/vi`.
4. Console locale works through a safe cookie/preference flow without URL prefixes.
5. Axios exists only inside `packages/api-client`.
6. TanStack Query has a configured provider and at least one justified real use case.
7. Zustand uses store factories and has at least one justified real use case.
8. No sensitive data is stored in client persistence.
9. UI, i18n, API-client, forms, and stores have unit coverage.
10. Playwright covers locale, forms, accessibility, error handling, and relevant time-zone behavior.
11. Bundle and dependency-policy gates run in CI.
12. All existing repository gates remain green.

## 24. Approved decisions

- Storefront locale URLs use `/vi` and `/en`.
- Console locale uses cookie/preference without a URL prefix.
- Tailwind and shadcn-derived components form the shared UI foundation.
- React Hook Form and Zod own form state and validation.
- Native `fetch` remains the server transport.
- Axios is limited to the client transport inside `packages/api-client`.
- TanStack Query owns interactive server state.
- Zustand owns focused client UI state.
- `nuqs` owns URL state.
- `next-intl` provides Next.js internationalization integration.
- Date/time behavior is explicit about tenant time zone and locale.
- The rollout is incremental and test-driven.
