# 90-Day Execution Plan

## Mục tiêu

Đưa hệ thống từ baseline đặc tả tới controlled Pilot, đồng thời xây lớp Genesis Internal tối thiểu.

## Nguyên tắc delivery

- Mỗi sprint có vertical slice demo được.
- Không xây toàn bộ backend rồi mới tích hợp frontend.
- Quality gate rủi ro cao là production-blocking.
- Scope UI phụ có thể giảm; security, RLS, ledger, idempotency, backup và operations không được giảm.

## Milestones

### Sprint 0 — Foundation

- Monorepo, CI/CD, Postgres, Redis và local object storage.
- Khởi tạo `web-storefront`, `web-console`, `api`, `worker-critical`, `worker-batch`.
- Logging, request ID, health/ready endpoints và Sentry skeleton.
- Custom-domain local smoke test.
- Knowledge CI và ADR process hoạt động.

**Exit:** toàn stack chạy bằng một quy trình chuẩn.

### Sprint 1–2 — Identity, Tenant and Isolation

- Global user, session, membership, dynamic RBAC.
- Tenant CRUD, domains, plans, subscription và entitlement.
- FORCE RLS, tenant transaction wrapper và isolation test.
- Admin onboarding tenant.

**Exit:** tenant được tạo và phân quyền an toàn; tenant A không truy cập tenant B.

### Sprint 3–5 — Partner, Catalog, Availability and Pricing

- Partner onboarding và approval.
- Listing type động, listing group, listing và resource.
- Schedule, exception, resource block, buffer và timezone.
- Pricing/quote snapshot.
- Publication/moderation và storefront searchable inventory.

**Exit:** inventory published có thể tìm kiếm và hiển thị slot/quote.

### Sprint 6–7 — Booking and Payment

- Hold, booking state machine, guest checkout và customer lookup.
- Mock/PayOS adapter, idempotent webhook và reconciliation.
- Confirmed booking end-to-end.
- Concurrency test cho cùng resource/slot.

**Exit:** giao dịch từ listing tới booking confirmed không cần sửa database.

### Sprint 8–9 — Finance and Operations

- Settlement snapshot và double-entry ledger.
- Refund manual-first, partner payable và manual payout.
- Notification outbox, operations workbench và audit.
- Finance reconciliation.

**Exit:** completed booking tạo settlement, ledger, payable và payout.

### Sprint 10–12 — Hardening and UAT

- UX states, reporting, accessibility và performance.
- Backup/restore test, runbooks và alerts.
- Security testing, UAT và training.

**Exit:** production-ready theo hard gates.

### Sprint 13 — Controlled Pilot

- Một tenant Pilot, số partner/listing giới hạn.
- Theo dõi giao dịch thật và hypercare.
- Go/No-Go review theo checklist.

## Hard Go/No-Go

- Không còn Severity 1 hoặc critical Finance/Security issue.
- Cross-tenant E2E pass.
- Double-booking concurrency pass.
- Ledger reconciliation pass.
- PayOS production/webhook verified.
- Refund và Payout có runbook + owner.
- Backup restore test thành công.
- Monitoring, alert, support và incident contact hoạt động.
