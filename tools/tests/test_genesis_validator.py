from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tools.genesis.artifact_types import ArtifactKind, definition_for
from tools.genesis.validator import validate_artifact_text, validate_repository

ACCEPTED_ADR = """---
id: ADR-0001
title: Complete
status: accepted
owner: owner
date: 2026-08-04
---

# Complete

## Context

Real context.

## Problem

Real problem.

## Options Considered

Option A and option B.

## Decision

Choose option A.

## Trade-offs

Documented trade-off.

## Consequences

Documented consequence.

## Validation

Tests and review.

## References

Approved design.
"""

DRAFT_ADR = """---
id: ADR-0002
title: Draft
status: proposed
owner: unassigned
date: 2026-08-04
---

# Draft

## Context

## Problem

## Options Considered

## Decision

## Trade-offs

## Consequences

## Validation

## References
"""

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


class ValidatorTest(unittest.TestCase):
    def test_allows_incomplete_draft_with_unassigned_owner(self) -> None:
        failures = validate_artifact_text(
            DRAFT_ADR,
            definition_for(ArtifactKind.ADR),
            Path("docs/adr/ADR-0002-draft.md"),
        )
        self.assertEqual(failures, [])

    def test_rejects_completed_placeholders_and_unassigned_owner(self) -> None:
        invalid = ACCEPTED_ADR.replace("owner: owner", "owner: unassigned").replace(
            "Real context.",
            "TODO",
        )
        failures = validate_artifact_text(
            invalid,
            definition_for(ArtifactKind.ADR),
            Path("docs/adr/ADR-0001-complete.md"),
        )
        messages = [failure.message for failure in failures]
        self.assertIn("accepted artifact owner must be assigned", messages)
        self.assertIn("accepted artifact contains forbidden placeholder: TODO", messages)

    def test_rejects_duplicate_ids_in_repository(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            write_templates(root)
            artifact_directory = root / "docs/adr"
            artifact_directory.mkdir(parents=True)
            (artifact_directory / "ADR-0001-first.md").write_text(ACCEPTED_ADR, encoding="utf-8")
            (artifact_directory / "ADR-0001-second.md").write_text(
                ACCEPTED_ADR.replace("title: Complete", "title: Second").replace(
                    "# Complete",
                    "# Second",
                ),
                encoding="utf-8",
            )

            messages = [failure.message for failure in validate_repository(root)]
            self.assertTrue(any(message.startswith("duplicate artifact id ADR-0001") for message in messages))


if __name__ == "__main__":
    unittest.main()
