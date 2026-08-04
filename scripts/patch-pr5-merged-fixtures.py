from pathlib import Path

replacements = [
    (
        "apps/api/src/health/health-response.factory.test.ts",
        "  readinessTimeoutMs: 750,\n};",
        "  readinessTimeoutMs: 750,\n  sessionSecret: \"test-only-session-secret-at-least-32-characters\",\n  paymentProvider: \"mock\",\n};",
    ),
    (
        "apps/api/src/health/readiness-checker.test.ts",
        "  redisUrl: \"redis://redis:6379/1\",\n  sessionSecret:",
        "  redisUrl: \"redis://redis:6379/1\",\n  readinessTimeoutMs: 750,\n  sessionSecret:",
    ),
    (
        "apps/api/src/health/readiness-coordinator.test.ts",
        "    readinessTimeoutMs: 750,\n  };",
        "    readinessTimeoutMs: 750,\n    sessionSecret: \"test-only-session-secret-at-least-32-characters\",\n    paymentProvider: \"mock\",\n  };",
    ),
    (
        "apps/api/src/observability/http-logging.interceptor.test.ts",
        "  readinessTimeoutMs: 750,\n};",
        "  readinessTimeoutMs: 750,\n  sessionSecret: \"test-only-session-secret-at-least-32-characters\",\n  paymentProvider: \"mock\",\n};",
    ),
    (
        "apps/api/src/reliability/outbox.repository.integration.test.ts",
        "  redisUrl: process.env.REDIS_URL ?? \"redis://localhost:6379/1\",\n  sessionSecret:",
        "  redisUrl: process.env.REDIS_URL ?? \"redis://localhost:6379/1\",\n  readinessTimeoutMs: 750,\n  sessionSecret:",
    ),
    (
        "apps/api/test/tenant-isolation.e2e.test.ts",
        "  redisUrl: process.env.REDIS_URL ?? \"redis://localhost:6379/1\",\n  sessionSecret:",
        "  redisUrl: process.env.REDIS_URL ?? \"redis://localhost:6379/1\",\n  readinessTimeoutMs: 750,\n  sessionSecret:",
    ),
]

for filename, old, new in replacements:
    path = Path(filename)
    text = path.read_text()
    if new in text:
        continue
    if old not in text:
        raise SystemExit(f"Expected fixture pattern not found in {filename}")
    path.write_text(text.replace(old, new, 1))
