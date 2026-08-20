from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tools.genesis.validator import validate_repository


MARKER = Path("docs/superpowers/plans/2026-08-16-sprint-2-tenant-dynamic-rbac.md")
FEATURE = Path("docs/features/FEATURE-0003-tenant-dynamic-rbac.md")
PATTERN = Path("docs/patterns/PATTERN-0004-tenant-dynamic-rbac-authority.md")
RECOVERY_RUNBOOK = Path("docs/runbooks/tenant-dynamic-rbac-recovery.md")
CHECKPOINT = Path("docs/superpowers/checkpoints/2026-08-16-sprint-2-dynamic-rbac-closeout.md")
DOMAIN_OWNERS = Path("docs/ownership/DOMAIN-OWNERS.md")
EXECUTION_PLAN = Path("docs/plan/90-DAY-EXECUTION.md")
PILOT_GATES = Path("genesis/reviews/PILOT-GATES.md")

DESIGN = "../superpowers/specs/2026-08-16-sprint-2-tenant-dynamic-rbac-design.md"
PLAN = "../superpowers/plans/2026-08-16-sprint-2-tenant-dynamic-rbac.md"
VERIFY_COMMAND = "pnpm verify:dynamic-rbac"
RECOVERY_SECTIONS = (
    "Accidental role assignment",
    "Accidental permission expansion",
    "Archived role impact",
    "Stale authority and session reconciliation",
    "RBAC mutation outage",
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


def valid_feature_without_closeout_references() -> str:
    return """---
id: FEATURE-0003
title: Tenant Dynamic RBAC
status: active
owner: authorization
date: 2026-08-20
---

# Tenant Dynamic RBAC

## Problem

Tenant authorization needs a canonical Sprint 2 closeout artifact.

## Goal

Document the implemented tenant dynamic RBAC boundary.

## Non-goals

Do not expand into platform or partner custom roles.

## Business Rules

Custom roles remain tenant scoped and fail closed.

## Acceptance Criteria

S2-RBAC01 through S2-RBAC16 remain executable evidence.

## Test Plan

Run protected repository gates.
"""


def valid_pattern() -> str:
    return """---
id: PATTERN-0004
title: Tenant Dynamic RBAC Authority
status: active
owner: authorization
date: 2026-08-20
---

# Tenant Dynamic RBAC Authority

## Problem

Dynamic authority must remain tenant scoped and concurrency safe.

## Context

Apply to tenant custom roles, permission mappings, and assignments.

## Solution

Resolve effective permissions from active same-tenant custom-role authority without widening system role keys.

## Trade-offs

Authority mutations require transactional locking and authorization-version invalidation.

## Review Checklist

- [x] Tenant scope is server authoritative.
"""


class Sprint2CloseoutValidationTest(unittest.TestCase):
    def test_requires_closeout_artifacts_when_sprint_2_plan_exists(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            write_templates(root)
            write(root, MARKER, "# Sprint 2 Tenant Dynamic RBAC\n")

            failures = validate_repository(root)
            paths = {failure.path.as_posix() for failure in failures}

            for required in (FEATURE, PATTERN, RECOVERY_RUNBOOK, CHECKPOINT):
                self.assertIn(required.as_posix(), paths)

    def test_requires_references_recovery_guidance_owner_and_delivery_markers(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            write_templates(root)
            write(root, MARKER, "# Sprint 2 Tenant Dynamic RBAC\n")
            write(root, FEATURE, valid_feature_without_closeout_references())
            write(root, PATTERN, valid_pattern())
            write(root, RECOVERY_RUNBOOK, "# Tenant Dynamic RBAC Recovery\n")
            write(root, CHECKPOINT, "# Sprint 2 Dynamic RBAC Closeout\n")
            write(root, EXECUTION_PLAN, "# 90 Day Execution\n")
            write(root, PILOT_GATES, "# Pilot Gates\n")
            write(
                root,
                DOMAIN_OWNERS,
                """# Domain Ownership

| Domain | Domain owner | Accountable owner |
| --- | --- | --- |
| Authorization | `unassigned` | `hiephanguyen01` |
""",
            )

            failures = validate_repository(root)
            rendered = "\n".join(
                f"{failure.path.as_posix()}: {failure.message}" for failure in failures
            )

            self.assertIn(DESIGN, rendered)
            self.assertIn(PLAN, rendered)
            self.assertIn(VERIFY_COMMAND, rendered)
            for section in RECOVERY_SECTIONS:
                self.assertIn(section, rendered)
            self.assertIn("Authorization domain owner must be assigned", rendered)
            self.assertIn("secret", rendered.lower())
            self.assertIn(EXECUTION_PLAN.as_posix(), rendered)
            self.assertIn(PILOT_GATES.as_posix(), rendered)


if __name__ == "__main__":
    unittest.main()
