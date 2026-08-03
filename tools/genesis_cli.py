#!/usr/bin/env python3
"""Minimal Genesis knowledge CLI with no external dependencies."""
from pathlib import Path
import argparse
import re
import sys
from datetime import date

ROOT = Path(__file__).resolve().parents[1]

REQUIRED_SECTIONS = {
    "ADR": ["## Context", "## Problem", "## Decision", "## Trade-offs", "## Consequences"],
    "PATTERN": ["## Problem", "## Context", "## Solution", "## Trade-offs", "## Review Checklist"],
    "FEATURE": ["## Problem", "## Goal", "## Non-goals", "## Business Rules", "## Acceptance Criteria", "## Test Plan"],
}

def parse_frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end == -1:
        return {}
    data = {}
    for line in text[4:end].splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            data[key.strip()] = value.strip()
    return data

def classify(path: Path) -> str | None:
    p = str(path).lower()
    if "/adr/" in p or path.name.startswith("ADR-"):
        return "ADR"
    if "/patterns/" in p or path.name == "PATTERN.md":
        return "PATTERN"
    if path.name == "FEATURE.md" or "/features/" in p:
        return "FEATURE"
    return None

def validate_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    kind = classify(path)
    errors = []
    if not kind:
        return errors
    metadata = parse_frontmatter(text)
    if not metadata:
        errors.append("missing YAML-like front matter")
    else:
        for key in ("id", "status", "owner"):
            if key not in metadata or not metadata[key]:
                errors.append(f"missing metadata: {key}")
    for section in REQUIRED_SECTIONS[kind]:
        if section not in text:
            errors.append(f"missing section: {section}")
    return errors

def validate() -> int:
    failures = 0
    for path in sorted(ROOT.rglob("*.md")):
        errors = validate_file(path)
        if errors:
            failures += 1
            print(f"FAIL {path.relative_to(ROOT)}")
            for err in errors:
                print(f"  - {err}")
    if failures:
        print(f"\n{failures} artifact(s) failed.")
        return 1
    print("Knowledge validation passed.")
    return 0

def slugify(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "decision"

def new_adr(title: str) -> int:
    adr_dir = ROOT / "docs" / "adr"
    ids = []
    for path in adr_dir.glob("ADR-*.md"):
        match = re.match(r"ADR-(\d{4})", path.name)
        if match:
            ids.append(int(match.group(1)))
    number = max(ids, default=0) + 1
    adr_id = f"ADR-{number:04d}"
    path = adr_dir / f"{adr_id}-{slugify(title)}.md"
    content = f"""---
id: {adr_id}
title: {title}
status: proposed
owner: unassigned
date: {date.today().isoformat()}
---

# {title}

## Context

## Problem

## Options Considered

## Decision

## Trade-offs

## Consequences

## Validation

## References
"""
    path.write_text(content, encoding="utf-8")
    print(path.relative_to(ROOT))
    return 0

def main() -> int:
    parser = argparse.ArgumentParser(prog="genesis")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate")
    adr = sub.add_parser("new-adr")
    adr.add_argument("title")
    args = parser.parse_args()
    if args.command == "validate":
        return validate()
    if args.command == "new-adr":
        return new_adr(args.title)
    return 2

if __name__ == "__main__":
    sys.exit(main())
