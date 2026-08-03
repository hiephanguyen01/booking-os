# Booking SaaS + Genesis Starter v0.1

Bộ khởi tạo để bắt đầu triển khai **Booking SaaS + Multi-Tenant Marketplace** và đồng thời trích xuất Genesis như một năng lực nội bộ.

## Quyết định nền tảng

1. **Xây Booking trước, trích xuất Genesis sau.**
2. Master Spec V4.0 là baseline nghiệp vụ và kiến trúc.
3. Repository triển khai theo vertical slice, mỗi sprint phải demo end-to-end.
4. Không cắt các quality gate về tenant isolation, double booking, ledger, payment idempotency, backup và operations.
5. Bộ `slavingia/skills` được dùng cho nhánh **business/product**, không thay thế skill kỹ thuật.

## Bắt đầu

```bash
python tools/genesis_cli.py validate
python tools/genesis_cli.py new-adr "Tên quyết định"
```

## Cấu trúc

- `docs/`: kiến trúc, ADR, backlog và kế hoạch delivery.
- `genesis/`: workflow, role, review checklist, template và business skills.
- `schemas/`: schema kiểm tra artifact.
- `tools/`: CLI tối thiểu.
- `.github/workflows/`: knowledge CI.
