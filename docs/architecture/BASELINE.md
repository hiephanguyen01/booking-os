# Architecture Baseline

## Source-of-truth amendments

- Product baseline: `booking-saas-marketplace-master-spec-v4-nextjs.docx`.
- Approved dated amendments supersede only the conflicting details they name; unaffected Master Spec requirements remain active.
- Current identity/authorization amendment: `docs/spec-amendments/2026-08-10-master-spec-v4-identity-authorization-amendment.md`.
- Sprint 1B active feature: `docs/features/FEATURE-0002-identity-access-core.md`.
- Host-bound opaque-session pattern: `docs/patterns/PATTERN-0003-host-bound-opaque-session.md`.

## Sản phẩm Pilot

Studio booking theo giờ, VND, vi/en, Instant Booking, đặt cọc online qua PayOS hoặc Mock, phần còn lại trả tại địa điểm.

## Deployment units

- `web-storefront`: Next.js public storefront, custom domain, SSR/RSC/ISR.
- `web-console`: Next.js console cho Platform, Tenant, Partner và Affiliate; browser identity/session đi qua BFF/server boundaries và host-only cookie contract.
- `api`: NestJS Modular Monolith; source of truth cho identity, sessions, memberships, authorization, security audit và tenant execution policy.
- `worker-critical`: payment, booking expiry, refund, settlement, payout; không nhận HTTP/browser identity privilege.
- `worker-batch`: notification, report, indexing và maintenance; identity email delivery chỉ xử lý encrypted outbox payload qua reviewed worker path.
- PostgreSQL là transactional source of truth.
- Redis chỉ dùng cho hold, cache và queue; không phải authorization truth.

## Identity and authorization baseline

- Global User là shared identity; tenant participation nằm ở membership.
- Browser không giữ API access token. Opaque session material được bind vào exact trusted host và explicit scope.
- `__Host-` session cookie, CSRF/Origin, no-store, redirect, CSP và log-redaction rules là security boundary, không phải UI preference.
- Protected request authority được rebuild/reconcile từ active user, membership, immutable system roles, permission catalog, resource/grant policy và authorization-version snapshots.
- `invitation_pending` chỉ đi qua restricted allowlist và không có normal permission authority.
- Security-state mutations write approved audit transactionally where atomicity is required; metrics use bounded catalog labels only.
- `/auth/me/authorization` exposes only authoritative current-scope data and remains non-cacheable.
- Customer/Partner scopes must extend this kernel in later slices rather than introduce a parallel authentication system.

## Architectural constraints

- Browser không giữ access token; Next.js hoạt động như BFF.
- Tenant scope lấy từ trusted session/host và được backend kiểm tra lại; body/query/arbitrary headers không establish tenant authority.
- PostgreSQL FORCE RLS cho dữ liệu tenant và là final tenant boundary.
- Active tenant luôn giữ ít nhất một active owner; application locking và database invariant cùng bảo vệ final-owner rule.
- Resource là đơn vị khóa lịch; Listing là đơn vị bán.
- Redis Hold không phải bảo đảm cuối cùng; PostgreSQL constraint/transaction mới là bảo đảm cuối.
- Ledger append-only, double-entry và sửa sai bằng reversal.
- Cross-module integration thông qua application contract hoặc domain event + outbox.
- Không giữ database transaction xuyên qua external call.
