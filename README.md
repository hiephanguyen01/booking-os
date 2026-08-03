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

## Local infrastructure

### Prerequisites

- Docker Desktop or Docker Engine with Docker Compose v2.
- Node.js and pnpm versions declared in the root `package.json`.

### Initialize

```bash
cp .env.docker.example .env.docker
pnpm infra:config
pnpm infra:up
```

The first startup builds MinIO Community from pinned source revisions, so it takes longer than later startups.

### Services

| Service | Endpoint | Local credentials |
| --- | --- | --- |
| PostgreSQL | `localhost:5432/booking_os` | `booking` / `booking` |
| Redis | `localhost:6379` | No password in local development |
| MinIO S3 API | `http://localhost:9000` | `minio` / `minio123` |
| MinIO Console | `http://localhost:9001` | `minio` / `minio123` |
| Mailpit SMTP | `localhost:1025` | No authentication |
| Mailpit UI | `http://localhost:8025` | No authentication |

These credentials are local development defaults only. Do not reuse them outside local development.

### Operations

```bash
pnpm infra:ps
pnpm infra:logs
pnpm infra:down
```

`pnpm infra:down` removes containers but preserves PostgreSQL, Redis, and MinIO named-volume data.

To remove all local infrastructure data:

```bash
pnpm infra:reset
```

This command is destructive.

### API environment

When the API runs on the host, use:

```dotenv
DATABASE_URL=postgresql://booking:booking@localhost:5432/booking_os
REDIS_URL=redis://localhost:6379/0
```

The MinIO API is available at `http://localhost:9000`, and Mailpit accepts SMTP on `localhost:1025`.

### Troubleshooting

Validate the rendered Compose model:

```bash
pnpm infra:config
```

Inspect status and logs:

```bash
pnpm infra:ps
pnpm infra:logs
```

If a host port is already occupied, change only the corresponding host port in `.env.docker`; container ports remain unchanged.

## Cấu trúc

- `docs/`: kiến trúc, ADR, backlog và kế hoạch delivery.
- `genesis/`: workflow, role, review checklist, template và business skills.
- `schemas/`: schema kiểm tra artifact.
- `tools/`: CLI tối thiểu.
- `.github/workflows/`: knowledge CI.
