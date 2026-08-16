from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tools.genesis.validator import validate_repository


MARKER = Path("docs/superpowers/plans/2026-08-05-sprint-1b-04-authorization-hardening.md")
FEATURE = Path("docs/features/FEATURE-0002-identity-access-core.md")
PATTERN = Path("docs/patterns/PATTERN-0003-host-bound-opaque-session.md")
RECOVERY_RUNBOOK = Path("docs/runbooks/identity-access-recovery.md")
BOOTSTRAP_RUNBOOK = Path("docs/runbooks/platform-admin-bootstrap.md")
CHECKPOINT = Path("docs/superpowers/checkpoints/2026-08-05-sprint-1b-closeout.md")
DOMAIN_OWNERS = Path("docs/ownership/DOMAIN-OWNERS.md")

DESIGN = "../superpowers/specs/2026-08-05-identity-membership-authorization-core-design.md"
PLANS = (
    "../superpowers/plans/2026-08-05-sprint-1b-01-identity-foundation.md",
    "../superpowers/plans/2026-08-05-sprint-1b-02-session-kernel.md",
    "../superpowers/plans/2026-08-05-sprint-1b-03-membership-provisioning.md",
    "../superpowers/plans/2026-08-05-sprint-1b-04-authorization-hardening.md",
)
BOOTSTRAP_COMMAND = "pnpm --filter @booking-os/api identity:bootstrap-platform-admin"
RECOVERY_COMMANDS = (
    "pnpm genesis:validate",
    "pnpm check:ci",
    "pnpm verify:architecture",
    "pnpm verify:migrations",
    "pnpm verify:identity-access",
    "pnpm verify:foundation",
)

TEMPLATES = {
    "ADR.md": """---
id: {{ id }}
title: {{ title }}
status: {{ status }}
owner: {{ owner }}
date: {{ date }}
---

# {{ title }}

## Context

## Problem

## Options Considered

## Decision

## Trade-offs

## Consequences

## Validation

## References
""",
    "FEATURE.md": """---
id: {{ id }}
title: {{ title }}
status: {{ status }}
owner: {{ owner }}
date: {{ date }}
---

# {{ title }}

## Problem

## Goal

## Non-goals

## Business Rules

## Acceptance Criteria

## Test Plan
""",
    "PATTERN.md": """---
id: {{ id }}
title: {{ title }}
status: {{ status }}
owner: {{ owner }}
date: {{ date }}
---

# {{ title }}

## Problem

## Context

## Solution

## Trade-offs

## Review Checklist
""",
}


def write_templates(root: Path) -> None:
    directory = root / "genesis/templates"
    directory.mkdir(parents=True)
    for name, content in TEMPLATES.items():
        (directory / name).write_text(content, encoding="utf-8")


def write(root: Path, path: Path, content: str) -> None:
    destination = root / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(content, encoding="utf-8")


def valid_feature_without_references() -> str:
    return """---
id: FEATURE-0002
title: Identity Access Core
status: active
owner: identity
2026-08-14: 2026-08-14
date: 2026-08-14
---

# Identity Access Core

## Problem

Identity access needs a canonical closeout artifact.

## Goal

Document the accepted Sprint 1B behavior.

## Non-goals

Do not expand product scope.

## Business Rules

Authoritative identity and authorization remain fail closed.

## Acceptance Criteria

Sprint 1B acceptance gates remain green.

## Test Plan

Run the protected repository gates.
"""


def valid_pattern() -> str:
    return """---
id: PATTERN-0003
title: Host-Bound Opaque Session
status: active
owner: sessions
date: 2026-08-14
---

# Host-Bound Opaque Session

## Problem

Sessions must not replay across hosts.

## Context

Apply to Booking OS browser sessions.

## Solution

Bind opaque sessions to exact trusted host and scope.

## Trade-offs

Host binding reduces portability by design.

## Review Checklist

- [x] Host binding is enforced.
"""


class Sprint1BCloseoutValidationTest(unittest.TestCase):
    def test_requires_closeout_artifacts_when_sprint_1b_plan_exists(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            write_templates(root)
            write(root, MARKER, "# Sprint 1B.4\n")

            failures = validate_repository(root)
            paths = {failure.path.as_posix() for failure in failures}

            for required in (FEATURE, PATTERN, RECOVERY_RUNBOOK, BOOTSTRAP_RUNBOOK, CHECKPOINT):
                self.assertIn(required.as_posix(), paths)

    def test_requires_links_safe_commands_and_identity_access_owners(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            write_templates(root)
            write(root, MARKER, "# Sprint 1B.4\n")
            write(root, FEATURE, valid_feature_without_references())
            write(root, PATTERN, valid_pattern())
            write(root, RECOVERY_RUNBOOK, "# Identity Access Recovery\n")
            write(root, BOOTSTRAP_RUNBOOK, "# Platform Admin Bootstrap\n")
            write(root, CHECKPOINT, "# Sprint 1B Closeout\n")
            write(
                root,
                DOMAIN_OWNERS,
                """# Domain Ownership

| Domain | Domain owner | Accountable owner |
| --- | --- | --- |
| Identity | `unassigned` | `hiephanguyen01` |
""",
            )

            failures = validate_repository(root)
            rendered = "\n".join(
                f"{failure.path.as_posix()}: {failure.message}" for failure in failures
            )

            self.assertIn(DESIGN, rendered)
            for plan in PLANS:
                self.assertIn(plan, rendered)
            self.assertIn(BOOTSTRAP_COMMAND, rendered)
            for command in RECOVERY_COMMANDS:
                self.assertIn(command, rendered)
            for domain in ("Identity", "Sessions", "Memberships", "Authorization"):
                self.assertIn(domain, rendered)
            self.assertIn("secret", rendered.lower())


if __name__ == "__main__":
    unittest.main()
