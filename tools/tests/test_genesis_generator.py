from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from tools.genesis.artifact_types import ArtifactKind
from tools.genesis.generator import GenerationError, generate_artifact

ADR_TEMPLATE = """---
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
"""


class GeneratorTest(unittest.TestCase):
    def test_allocates_type_local_id_and_renders_template(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "genesis/templates").mkdir(parents=True)
            (root / "docs/adr").mkdir(parents=True)
            (root / "genesis/templates/ADR.md").write_text(ADR_TEMPLATE, encoding="utf-8")
            (root / "docs/adr/ADR-0001-existing.md").write_text("existing", encoding="utf-8")

            path = generate_artifact(
                root,
                ArtifactKind.ADR,
                "Stable API Contract",
                today=date(2026, 8, 4),
            )

            self.assertEqual(path.name, "ADR-0002-stable-api-contract.md")
            text = path.read_text(encoding="utf-8")
            self.assertIn("id: ADR-0002", text)
            self.assertIn("status: proposed", text)
            self.assertIn("owner: unassigned", text)
            self.assertIn("date: 2026-08-04", text)

    def test_rejects_empty_slug_without_partial_file(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(
                GenerationError,
                "title must contain at least one ASCII letter or digit",
            ):
                generate_artifact(root, ArtifactKind.ADR, "---", today=date(2026, 8, 4))
            self.assertEqual(list(root.rglob("*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
