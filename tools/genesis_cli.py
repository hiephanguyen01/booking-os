#!/usr/bin/env python3
"""Genesis knowledge artifact CLI with no external dependencies."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys

from tools.genesis.artifact_types import ArtifactKind
from tools.genesis.generator import GenerationError, generate_artifact
from tools.genesis.validator import validate_repository

ROOT = Path(os.environ.get("GENESIS_ROOT", Path(__file__).resolve().parents[1])).resolve()
COMMAND_TO_KIND = {
    "new-adr": ArtifactKind.ADR,
    "new-feature": ArtifactKind.FEATURE,
    "new-pattern": ArtifactKind.PATTERN,
}


class GenesisArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ValueError(message)


def validate() -> int:
    failures = validate_repository(ROOT)
    if not failures:
        print("Knowledge validation passed.")
        return 0

    current_path: Path | None = None
    for failure in failures:
        if failure.path != current_path:
            current_path = failure.path
            print(f"FAIL {failure.path.as_posix()}")
        print(f"  - {failure.message}")
    print(f"\n{len({failure.path for failure in failures})} artifact or template file(s) failed.")
    return 1


def build_parser() -> GenesisArgumentParser:
    parser = GenesisArgumentParser(prog="genesis")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("validate")
    for command in COMMAND_TO_KIND:
        artifact_parser = subparsers.add_parser(command)
        artifact_parser.add_argument("title")
    return parser


def main(argv: list[str] | None = None) -> int:
    try:
        args = build_parser().parse_args(argv)
        if args.command == "validate":
            return validate()

        kind = COMMAND_TO_KIND[args.command]
        path = generate_artifact(ROOT, kind, args.title)
        print(path.relative_to(ROOT).as_posix())
        return 0
    except (GenerationError, ValueError, KeyError) as error:
        print(f"genesis: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
