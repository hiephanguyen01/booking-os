import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import unittest

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


class GenesisCliTest(unittest.TestCase):
    def test_generates_and_validates_feature_in_isolated_root(self) -> None:
        repository_root = Path(__file__).resolve().parents[2]
        script = repository_root / "tools/genesis_cli.py"
        with TemporaryDirectory() as directory:
            root = Path(directory)
            template_directory = root / "genesis/templates"
            template_directory.mkdir(parents=True)
            for name, content in TEMPLATES.items():
                (template_directory / name).write_text(content, encoding="utf-8")

            environment = os.environ.copy()
            environment["GENESIS_ROOT"] = str(root)
            generated = subprocess.run(
                [sys.executable, str(script), "new-feature", "Guest Checkout"],
                cwd=repository_root,
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(generated.returncode, 0, generated.stderr)
            self.assertEqual(
                generated.stdout.strip(),
                "docs/features/FEATURE-0001-guest-checkout.md",
            )
            self.assertTrue((root / generated.stdout.strip()).is_file())

            validated = subprocess.run(
                [sys.executable, str(script), "validate"],
                cwd=repository_root,
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(validated.returncode, 0, validated.stdout + validated.stderr)
            self.assertIn("Knowledge validation passed.", validated.stdout)

    def test_invalid_title_returns_usage_error_without_writing(self) -> None:
        repository_root = Path(__file__).resolve().parents[2]
        script = repository_root / "tools/genesis_cli.py"
        with TemporaryDirectory() as directory:
            environment = os.environ.copy()
            environment["GENESIS_ROOT"] = directory
            result = subprocess.run(
                [sys.executable, str(script), "new-adr", "---"],
                cwd=repository_root,
                env=environment,
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 2)
            self.assertIn("title must contain at least one ASCII letter or digit", result.stderr)
            self.assertEqual(list(Path(directory).rglob("*.md")), [])


if __name__ == "__main__":
    unittest.main()
