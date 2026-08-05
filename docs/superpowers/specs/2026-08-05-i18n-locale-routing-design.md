# Booking OS i18n, locale routing, and message architecture

**Status:** Approved design

**Date:** 2026-08-05

**Branch:** `docs/i18n-locale-routing-design`

## 1. Purpose

This design establishes a production-ready internationalization boundary for Booking OS. It replaces the current flat message-object helper with a `next-intl` integration that works with Next.js App Router, Server Components, client components, localized storefront routes, console locale preferences, validation codes, API error codes, SEO metadata, tenant content, and timezone-aware formatting.

The design intentionally uses the native `next-intl` mental model and APIs. Custom APIs discussed during exploration, including `NsI18n`, `useTranslation`, and `j()`, are not part of the approved architecture.

## 2. Scope

In scope:

- Vietnamese and English UI messages.
- Storefront locale prefixes: `/vi/...` and `/en/...`.
- Console locale preference without a URL prefix.
- Shared locale configuration and message catalogs in `packages/i18n`.
- Server and client translation access through `next-intl`.
- Localized metadata, canonical URLs, and language alternates for public pages.
- Translation of validation and API error codes.
- Locale-aware date, time, number, plural, and currency formatting.
- Automated message parity and routing checks.

Out of scope:

- A tenant-facing translation CMS.
- Automatic translation of tenant-authored content.
- Localized business slugs in the first implementation.
- Additional locales beyond `vi` and `en`.
- A custom translation runtime or custom string-composition language.

## 3. Current state

The repository already contains `packages/i18n` with Vietnamese and English message objects, a locale normalizer, and a `getMessage` helper. Both Next.js applications depend on that package, but the storefront still renders from a root App Router layout without a locale segment, and the console reads translations without a complete locale-preference boundary.

The migration will preserve existing message meaning while replacing the flat runtime API with namespaced catalogs and `next-intl` integration.

## 4. Architecture decisions

### 4.1 Supported locales

```ts
export const locales = ["vi", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "vi";
```

`vi` is the application default. An unsupported locale is invalid input and must not silently fall back inside a localized route.

### 4.2 Storefront routing

The storefront exposes locale-prefixed public URLs:

```text
/                     -> redirect /vi
/vi                   -> Vietnamese storefront home
/en                   -> English storefront home
/vi/services
/en/services
/vi/book/[slug]
/en/book/[slug]
```

Target structure:

```text
apps/web-storefront/
├── app/
│   ├── [locale]/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── services/
│   │   └── book/
│   ├── globals.css
│   └── not-found.tsx
├── src/i18n/
│   ├── request.ts
│   └── navigation.ts
└── middleware.ts
```

Rules:

- `/` redirects to `/vi`.
- Unsupported locale segments such as `/fr/services` return `404`.
- Storefront navigation uses the locale-aware helpers created by `next-intl`, not manually concatenated locale strings.
- Switching locale preserves the logical route and route parameters.
- Business slugs remain unchanged during locale switching in the foundation phase.

### 4.3 Console locale resolution

Console routes remain unprefixed:

```text
/
/activate
/password/forgot
/password/reset
/bookings
/settings
```

Locale resolution order:

1. Authenticated user locale preference, when available.
2. `BOOKING_OS_LOCALE` cookie.
3. `Accept-Language`.
4. `vi`.

The application must normalize every candidate to a supported locale before use.

Changing locale updates the preference endpoint or action, writes the cookie, and refreshes the current route. It must not navigate to a different business route or discard current URL state.

Cookie contract:

```text
Name: BOOKING_OS_LOCALE
Values: vi | en
Path: /
SameSite: Lax
Secure: true in production
Max-Age: 31536000
HttpOnly: false
```

The cookie is a display preference, not an authentication credential.

## 5. Shared `packages/i18n` boundary

Target structure:

```text
packages/i18n/
├── messages/
│   ├── vi/
│   │   ├── common.json
│   │   ├── navigation.json
│   │   ├── auth.json
│   │   ├── booking.json
│   │   ├── service.json
│   │   ├── staff.json
│   │   ├── customer.json
│   │   ├── payment.json
│   │   ├── validation.json
│   │   ├── error.json
│   │   ├── date.json
│   │   └── debug.json
│   └── en/
│       └── matching files
├── src/
│   ├── config.ts
│   ├── locale.ts
│   ├── load-messages.ts
│   ├── message-types.ts
│   └── index.ts
└── tests/
```

The package owns:

- Supported locale definitions.
- Default locale.
- Locale normalization and validation.
- Message catalog loading and merging.
- Message key parity validation between locales.
- Shared message types.
- Shared date, number, currency, and relative-time formatting defaults.

The package does not own:

- Next.js middleware.
- Redirect behavior.
- Cookie access.
- Authentication or tenant resolution.
- React provider placement.
- Route-specific message selection.

These responsibilities remain in each app.

## 6. Message namespaces

Messages are grouped by product feature and user task, not by generic UI element type.

Approved namespaces:

```text
common
navigation
auth
booking
service
staff
customer
payment
validation
error
date
debug
```

Examples:

```json
{
  "activation": {
    "title": "Kích hoạt tài khoản",
    "description": "Tạo mật khẩu để hoàn tất tài khoản của bạn.",
    "submit": "Kích hoạt tài khoản",
    "success": "Tài khoản đã được kích hoạt."
  }
}
```

Usage:

```tsx
const t = await getTranslations("auth.activation");

return <h1>{t("title")}</h1>;
```

Client usage:

```tsx
const t = useTranslations("auth.activation");
```

Rules:

- Keys describe stable product meaning, not source-language text.
- `common` contains only truly shared actions, status labels, and generic controls.
- Feature-specific text must remain in its feature namespace.
- Components must not implement namespace fallback order.
- Components must not concatenate translated fragments to construct grammar.
- ICU interpolation, pluralization, and rich-text APIs are used for grammatical sentences.

## 7. Server and client translation access

Server Components are the default translation boundary:

```tsx
const t = await getTranslations("booking.details");
```

Client Components use `useTranslations` only when interactivity requires a client component.

`NextIntlClientProvider` receives only the message subset required by the client subtree. The complete application catalog must not be serialized to every route.

Approved APIs include:

- `getTranslations` for server translation.
- `useTranslations` for client translation.
- `getFormatter` or `useFormatter` for locale-aware formatting.
- `getLocale` or `useLocale` where locale inspection is necessary.
- `t.rich` for messages containing React-rendered elements.
- `t.raw` only for intentionally structured static translation values.

No wrapper may change these semantics without a separate reviewed design.

## 8. Navigation

Storefront links use a locale-aware navigation module created through `next-intl`.

```tsx
import { Link } from "@/i18n/navigation";

<Link
  href={{
    pathname: "/services/[slug]",
    params: { slug },
  }}
>
  {serviceName}
</Link>
```

The following is prohibited:

```tsx
<Link href={`/vi/services/${slug}`} />
```

The locale switcher must preserve pathname, dynamic parameters, and safe query parameters.

## 9. Validation messages

React Hook Form and Zod return stable validation codes, not localized prose.

Example validation codes:

```text
REQUIRED
INVALID_EMAIL
PASSWORD_TOO_SHORT
PASSWORD_CONFIRMATION_MISMATCH
INVALID_PHONE_NUMBER
```

The UI maps these codes through the `validation` namespace:

```tsx
const t = useTranslations("validation");

<FieldError>{t(issue.code, issue.params)}</FieldError>
```

Rules:

- Validation rules are shared across locales.
- The server validates again using the authoritative contract.
- Client validation improves UX but is not a security boundary.
- Variable values such as minimum length are passed as interpolation parameters.

## 10. API error messages

The API returns stable machine-readable error codes and request correlation data:

```json
{
  "code": "IDENTITY_ACTIVATION_TOKEN_EXPIRED",
  "requestId": "req_123"
}
```

The frontend maps the code through the `error` namespace:

```tsx
const t = useTranslations("error");
const message = t.has(error.code) ? t(error.code) : t("UNKNOWN");
```

Rules:

- Raw backend error prose is never displayed directly.
- Missing error translations use `error.UNKNOWN`.
- The request ID remains visible in support-oriented error states.
- Development and CI report missing keys as defects.
- Production logs a safe observability event and renders the fallback.

## 11. Pluralization and interpolation

Complete grammatical messages use ICU syntax. UI code must not manually join translated fragments.

Example:

```json
{
  "bookingCount": "{count, plural, =0 {Không có lịch đặt} one {# lịch đặt} other {# lịch đặt}}"
}
```

Usage:

```tsx
t("bookingCount", { count });
```

Rich content uses `t.rich` rather than a custom join helper:

```tsx
t.rich("terms", {
  termsLink: (children) => <Link href="/terms">{children}</Link>,
});
```

## 12. Dates, timezones, numbers, and currency

Display formatting separates locale from business timezone and currency.

```text
Database instant -> UTC
Tenant timezone  -> IANA timezone, for example Asia/Ho_Chi_Minh
API               -> ISO-8601
UI calendar       -> tenant timezone
Display language  -> active locale
Currency          -> tenant currency
```

Formatting uses `next-intl` formatters and approved date utilities. UI components must not rely on the browser timezone for tenant booking calculations.

Examples:

```tsx
format.number(amount, {
  style: "currency",
  currency: tenant.currency,
});
```

```tsx
format.dateTime(date, {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: tenant.timeZone,
});
```

## 13. Public metadata and SEO

Every localized public page provides locale-aware metadata:

- `<html lang>`.
- Localized title and description.
- Canonical URL.
- Vietnamese and English alternates.
- Open Graph locale metadata.

Console pages are authenticated application surfaces and do not require language alternate metadata.

## 14. Tenant-authored content

Tenant-authored service names, descriptions, policies, staff biographies, and similar content are business data, not application messages.

A future domain model may support localized values:

```ts
interface LocalizedText {
  vi?: string;
  en?: string;
}
```

Fallback order for localized tenant content:

1. Active locale.
2. Tenant default locale.
3. First available non-empty value.

The foundation does not include a translation editor or automatic translation workflow.

## 15. Error handling

- Unsupported storefront locale: `404`.
- Missing locale cookie: resolve through the documented fallback order.
- Invalid locale cookie: ignore and replace with a supported resolved locale.
- Missing message in development or CI: fail the relevant check.
- Missing message in production: render the approved fallback and emit a safe observability event.
- Message catalog load failure: render the route error boundary rather than silently rendering mixed-language content.
- Invalid ICU message syntax: fail build or CI validation.

## 16. Testing strategy

### Unit tests

- Locale normalization accepts `vi`, `vi-VN`, `en`, and `en-US` correctly.
- Unsupported locale values are rejected.
- Vietnamese and English catalogs contain identical key paths.
- Catalogs contain no empty messages.
- ICU message syntax is valid.
- Validation and API error codes resolve to translations or the documented fallback.
- Date, number, plural, and currency formatting use the requested locale and timezone.

### App integration tests

- `/` redirects to `/vi`.
- `/vi` and `/en` render the expected locale.
- Unsupported locale routes return `404`.
- Locale-aware navigation preserves route parameters.
- Storefront locale switching preserves logical pathname and query state.
- Console locale resolution follows user preference, cookie, header, then default.
- Console locale switching preserves the current route.
- Identity pages render translated validation and API errors.

### Browser tests

- Storefront language switch updates visible content, URL prefix, and `<html lang>`.
- Console language switch updates visible content without changing route shape.
- Refresh preserves the console locale cookie.
- A missing API error translation renders `error.UNKNOWN` and the request ID.
- Canonical and alternate metadata are correct for Vietnamese and English pages.

### CI gates

- Message parity validation.
- ICU syntax validation.
- No empty message values.
- Route behavior tests.
- Locale preference tests.
- Localized metadata tests.

## 17. Migration sequence

1. Add `next-intl` and shared locale configuration.
2. Convert existing flat Vietnamese and English messages into namespaced catalogs without changing meaning.
3. Add catalog parity and ICU validation tests.
4. Introduce storefront locale middleware, `[locale]` layout, and locale-aware navigation.
5. Migrate storefront pages and metadata.
6. Introduce console request configuration and locale preference cookie.
7. Migrate console root and identity pages.
8. Replace raw validation and API error prose with stable code lookup.
9. Add browser coverage for switching and persistence.
10. Remove the legacy `getMessage` path after all consumers migrate.

Every migration task follows test-driven development and must preserve the existing identity journey and current architecture gates.

## 18. Acceptance criteria

The design is complete when:

- Storefront public pages are available under `/vi` and `/en`.
- `/` redirects to `/vi`.
- Invalid locale routes return `404`.
- Console routes remain unprefixed and persist locale through the approved preference boundary.
- Application messages are namespaced and have Vietnamese-English key parity.
- Server and client components use native `next-intl` APIs.
- No custom `NsI18n`, `useTranslation`, or `j()` runtime is introduced.
- Validation and API errors render from stable translation codes.
- Dates, currency, plurals, and rich text use locale-aware formatters.
- Localized metadata is correct for public storefront pages.
- Existing identity tests and repository verification gates remain green.
