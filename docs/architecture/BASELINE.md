# Architecture Baseline

## Source-of-truth amendments

- Product baseline: `booking-saas-marketplace-master-spec-v4-nextjs.docx`.
- Approved dated amendments supersede only the conflicting details they name; unaffected Master Spec requirements remain active.
- Current identity/authorization amendment: `docs/spec-amendments/2026-08-10-master-spec-v4-identity-authorization-amendment.md`.

## Sản phẩm Pilot

Studio booking theo giờ, VND, vi/en, Instant Booking, đặt cọc online qua PayOS hoặc Mock, phần còn lại trả tại địa điểm.

## Deployment units

- `web-storefront`: Next.js public storefront, custom domain, SSR/RSC/ISR.
- `web-console`: Next.js console cho Platform, Tenant, Partner và Affiliate.
- `api`: NestJS Modular Monolith.
- `worker-critical`: payment, booking expiry, refund, settlement, payout.
- `worker-batch`: notification, report, indexing và maintenance.
- PostgreSQL là transactional source of truth.
- Redis chỉ dùng cho hold, cache và queue.

## Architectural constraints

- Browser không giữ access token; Next.js hoạt động như BFF.
- Tenant scope lấy từ session/host và được backend kiểm tra lại.
- PostgreSQL FORCE RLS cho dữ liệu tenant.
- Resource là đơn vị khóa lịch; Listing là đơn vị bán.
- Redis Hold không phải bảo đảm cuối cùng; PostgreSQL constraint/transaction mới là bảo đảm cuối.
- Ledger append-only, double-entry và sửa sai bằng reversal.
- Cross-module integration thông qua application contract hoặc domain event + outbox.
- Không giữ database transaction xuyên qua external call.
