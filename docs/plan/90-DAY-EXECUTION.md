# 90-Day Execution Plan

## Mục tiêu

Đưa hệ thống từ baseline đặc tả tới controlled Pilot, đồng thời xây lớp Genesis Internal tối thiểu.

## Nguyên tắc delivery

- Mỗi sprint có vertical slice demo được.
- Không xây toàn bộ backend rồi mới tích hợp frontend.
- Quality gate rủi ro cao là production-blocking.
- Scope UI phụ có thể giảm; security, RLS, ledger, idempotency, backup và operations không được giảm.
- Dated amendments dưới `docs/spec-amendments/` supersede chỉ các chi tiết Master Spec mà amendment nêu rõ; các yêu cầu còn lại của Master Spec vẫn giữ nguyên.
- Sprint 1B là identity/session/authorization kernel cho Platform/Tenant administration, không phải auth scope cuối cùng của Customer/Partner.

## Milestones

### Sprint 0 — Foundation

- Monorepo, CI/CD, Postgres, Redis và local object storage.
- Khởi tạo `web-storefront`, `web-console`, `api`, `worker-critical`, `worker-batch`.
- Logging, request ID, health/ready endpoints và Sentry skeleton.
- Custom-domain local smoke test.
- Knowledge CI và ADR process hoạt động.

**Exit:** toàn stack chạy bằng một quy trình chuẩn.

### Sprint 1–2 — Identity, Tenant and Isolation

**Sprint 1B status:** implementation and acceptance are verified; closeout artifacts are maintained in `docs/features/FEATURE-0002-identity-access-core.md`, `docs/patterns/PATTERN-0003-host-bound-opaque-session.md`, and the identity-access/bootstrap runbooks. Sprint 1B remains the shared kernel that later scopes extend.

**Sprint 2 dynamic RBAC status:** backend implementation and `S2-RBAC01`–`S2-RBAC16` acceptance are protected by `pnpm verify:dynamic-rbac`; closeout knowledge is maintained in `docs/features/FEATURE-0003-tenant-dynamic-rbac.md`, `docs/patterns/PATTERN-0004-tenant-dynamic-rbac-authority.md`, and `docs/runbooks/tenant-dynamic-rbac-recovery.md`. Sprint 2 extends, rather than replaces, the Sprint 1B security/session/authorization kernel.

- Sprint 1B: global user, opaque host-bound session, membership, fixed immutable system roles, code-seeded Permission Catalog V2, authoritative permission/resource guards, authorization-version reconciliation, transactional security audit, bounded metrics, browser hardening, and `S1B-AC01`–`S1B-AC15` acceptance matrix.
- Sprint 2: tenant-scoped dynamic RBAC trên Permission Catalog V2 — custom role CRUD, role-permission mapping, assignment/revocation, grant boundaries, audit và authorization-version invalidation; system roles vẫn immutable.
- Tenant CRUD, domains, plans, subscription và entitlement.
- FORCE RLS, tenant transaction wrapper và isolation test.
- Admin onboarding tenant.
- Full three-level Platform/Tenant/Partner Role Builder UI không thuộc Sprint 1B; UI đầy đủ nằm ở Phase 2 sau khi các scope backend tương ứng tồn tại.

**Exit:** tenant được tạo và phân quyền an toàn; tenant A không truy cập tenant B; tenant dynamic-RBAC backend foundation có đường nâng cấp rõ từ Sprint 1B system roles.

### Sprint 3–5 — Partner, Catalog, Availability and Pricing

- Partner onboarding và approval.
- Partner registration dùng email verification link và mở rộng shared identity/session kernel; Partner authorization scope/role foundation được thêm cùng Partner delivery thay vì tạo auth system riêng.
- Listing type động, listing group, listing và resource.
- Schedule, exception, resource block, buffer và timezone.
- Pricing/quote snapshot.
- Publication/moderation và storefront searchable inventory.

**Exit:** inventory published có thể tìm kiếm và hiển thị slot/quote; Partner actor đi qua cùng security/session invariants với Platform/Tenant kernel.

### Sprint 6–7 — Booking and Payment

- Hold, booking state machine, guest checkout và customer lookup.
- Customer self-registration và quên/đặt lại mật khẩu dùng OTP 6 số qua email ở initial delivery; challenge model giữ channel-independent để có thể thêm SMS adapter sau mà không redesign domain flow.
- Customer session dùng shared opaque-session/host/CSRF/security kernel; không tạo parallel authentication system.
- Mock/PayOS adapter, idempotent webhook và reconciliation.
- Confirmed booking end-to-end.
- Concurrency test cho cùng resource/slot.
- Google/Facebook social login vẫn deferred; Pilot UI không hiển thị nút social chưa hoạt động.

**Exit:** giao dịch từ listing tới booking confirmed không cần sửa database; Customer có auth flow initial-cost phù hợp trước các account-required booking journeys.

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

## Post-Pilot / Phase 2 RBAC UI

- Full three-level Role Builder UI cho Platform/Tenant/Partner chỉ được mở khi scope backend tương ứng và grant-policy/audit/concurrency gates đã tồn tại.
- Permission vẫn là code-seeded append-only capability identifiers; Role/RolePermission mapping mới là phần động.

## Hard Go/No-Go

- Không còn Severity 1 hoặc critical Finance/Security issue.
- Cross-tenant E2E pass.
- Double-booking concurrency pass.
- Ledger reconciliation pass.
- PayOS production/webhook verified.
- Refund và Payout có runbook + owner.
- Backup restore test thành công.
- Monitoring, alert, support và incident contact hoạt động.
