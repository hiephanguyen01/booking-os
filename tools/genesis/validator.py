"""Lifecycle-aware validation for Genesis knowledge artifacts."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from pathlib import Path
import re

from .artifact_types import DEFINITIONS, ArtifactDefinition
from .frontmatter import FrontmatterError, parse_frontmatter

REQUIRED_METADATA = ("id", "title", "status", "owner", "date")
TEMPLATE_PLACEHOLDERS = frozenset({"id", "title", "status", "owner", "date"})
PLACEHOLDER_PATTERN = re.compile(r"{{\s*([^}]+?)\s*}}")
FORBIDDEN_PLACEHOLDERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("TODO", re.compile(r"\bTODO\b", re.IGNORECASE)),
    ("TBD", re.compile(r"\bTBD\b", re.IGNORECASE)),
    ("template placeholder", re.compile(r"{{[^}]+}}")),
    ("template comment", re.compile(r"<!--\s*template", re.IGNORECASE)),
)
SECTION_PATTERN = re.compile(r"^##\s+(.+?)\s*$", re.MULTILINE)
HTML_COMMENT_PATTERN = re.compile(r"<!--.*?-->", re.DOTALL)


@dataclass(frozen=True, order=True)
class ValidationFailure:
    path: Path
    message: str


def _sections(body: str) -> dict[str, str]:
    matches = list(SECTION_PATTERN.finditer(body))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(body)
        sections[match.group(1)] = body[start:end].strip()
    return sections


def _is_substantive(value: str) -> bool:
    without_comments = HTML_COMMENT_PATTERN.sub("", value)
    return any(character.isalnum() for character in without_comments)


def validate_artifact_text(
    text: str,
    definition: ArtifactDefinition,
    path: Path,
) -> list[ValidationFailure]:
    failures: list[ValidationFailure] = []
    try:
        document = parse_frontmatter(text)
    except FrontmatterError as error:
        return [ValidationFailure(path, str(error))]

    metadata = document.metadata
    for key in REQUIRED_METADATA:
        if not metadata.get(key, "").strip():
            failures.append(ValidationFailure(path, f"missing metadata: {key}"))

    artifact_id = metadata.get("id", "")
    expected_id = re.compile(rf"^{re.escape(definition.prefix)}-\d{{4}}$")
    if artifact_id and not expected_id.fullmatch(artifact_id):
        failures.append(
            ValidationFailure(path, f"invalid id for {definition.kind.value}: {artifact_id}")
        )
    if artifact_id and not path.name.startswith(f"{artifact_id}-"):
        failures.append(
            ValidationFailure(path, f"filename must start with artifact id: {artifact_id}")
        )

    status = metadata.get("status", "")
    if status and status not in definition.allowed_statuses:
        failures.append(
            ValidationFailure(
                path,
                f"invalid status for {definition.kind.value}: {status}",
            )
        )

    date_value = metadata.get("date", "")
    if date_value:
        try:
            date.fromisoformat(date_value)
        except ValueError:
            failures.append(ValidationFailure(path, f"invalid ISO date: {date_value}"))

    sections = _sections(document.body)
    for section in definition.required_sections:
        if section not in sections:
            failures.append(ValidationFailure(path, f"missing section: ## {section}"))

    completed = status in definition.completed_statuses or status in definition.historical_statuses
    if completed:
        owner = metadata.get("owner", "").strip()
        if not owner or owner == "unassigned":
            failures.append(
                ValidationFailure(path, f"{status} artifact owner must be assigned")
            )

        for section in definition.required_sections:
            if section in sections and not _is_substantive(sections[section]):
                failures.append(
                    ValidationFailure(path, f"{status} artifact section is empty: ## {section}")
                )

        for label, pattern in FORBIDDEN_PLACEHOLDERS:
            if pattern.search(document.body):
                failures.append(
                    ValidationFailure(
                        path,
                        f"{status} artifact contains forbidden placeholder: {label}",
                    )
                )

    return sorted(failures, key=lambda failure: (failure.path.as_posix(), failure.message))


def validate_artifact(path: Path, definition: ArtifactDefinition) -> list[ValidationFailure]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        return [ValidationFailure(path, f"cannot read artifact: {error}")]
    return validate_artifact_text(text, definition, path)


def validate_template(root: Path, definition: ArtifactDefinition) -> list[ValidationFailure]:
    path = root / definition.template
    relative = definition.template
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as error:
        return [ValidationFailure(relative, f"cannot read template: {error}")]

    placeholders = frozenset(match.group(1).strip() for match in PLACEHOLDER_PATTERN.finditer(text))
    failures: list[ValidationFailure] = []
    if placeholders != TEMPLATE_PLACEHOLDERS:
        failures.append(
            ValidationFailure(
                relative,
                "template placeholders must be exactly: date, id, owner, status, title",
            )
        )
    for section in definition.required_sections:
        if f"## {section}" not in text:
            failures.append(ValidationFailure(relative, f"missing section: ## {section}"))
    return failures


def validate_repository(root: Path) -> list[ValidationFailure]:
    failures: list[ValidationFailure] = []
    ids: dict[str, Path] = {}

    for definition in DEFINITIONS.values():
        failures.extend(validate_template(root, definition))
        directory = root / definition.destination
        if not directory.exists():
            continue
        for absolute_path in sorted(directory.glob("*.md")):
            relative_path = absolute_path.relative_to(root)
            try:
                text = absolute_path.read_text(encoding="utf-8")
            except OSError as error:
                failures.append(
                    ValidationFailure(relative_path, f"cannot read artifact: {error}")
                )
                continue

            failures.extend(validate_artifact_text(text, definition, relative_path))
            try:
                metadata = parse_frontmatter(text).metadata
            except FrontmatterError:
                continue
            artifact_id = metadata.get("id", "")
            if not artifact_id:
                continue
            previous = ids.get(artifact_id)
            if previous is not None:
                failures.append(
                    ValidationFailure(
                        relative_path,
                        f"duplicate artifact id {artifact_id}; first declared in {previous.as_posix()}",
                    )
                )
            else:
                ids[artifact_id] = relative_path

    return sorted(failures, key=lambda failure: (failure.path.as_posix(), failure.message))
