"""Strict YAML-like scalar front matter parsing without third-party dependencies."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


class FrontmatterError(ValueError):
    """Raised when an artifact front matter block is malformed."""


@dataclass(frozen=True)
class ParsedDocument:
    metadata: dict[str, str]
    body: str


def parse_frontmatter(text: str) -> ParsedDocument:
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        raise FrontmatterError("missing opening front matter delimiter")

    try:
        closing_index = lines.index("---", 1)
    except ValueError as error:
        raise FrontmatterError("missing closing front matter delimiter") from error

    metadata: dict[str, str] = {}
    for line_number, line in enumerate(lines[1:closing_index], start=2):
        if not line.strip():
            raise FrontmatterError(f"empty front matter line at {line_number}")
        if ":" not in line:
            raise FrontmatterError(f"invalid front matter line at {line_number}")
        key, value = line.split(":", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            raise FrontmatterError(f"empty front matter key at {line_number}")
        if key in metadata:
            raise FrontmatterError(f"duplicate front matter key: {key}")
        metadata[key] = value

    body_lines = lines[closing_index + 1 :]
    if body_lines and body_lines[0] == "":
        body_lines = body_lines[1:]
    body = "\n".join(body_lines)
    if body and text.endswith("\n"):
        body += "\n"
    return ParsedDocument(metadata=metadata, body=body)


def render_frontmatter(metadata: Mapping[str, str], body: str) -> str:
    header = "\n".join(["---", *(f"{key}: {value}" for key, value in metadata.items()), "---"])
    rendered = f"{header}\n\n{body.lstrip(chr(10))}"
    if not rendered.endswith("\n"):
        rendered += "\n"
    return rendered
