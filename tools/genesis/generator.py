"""Atomic generation of Genesis artifacts from canonical templates."""
from __future__ import annotations

from datetime import date
import os
from pathlib import Path
import re
import tempfile

from .artifact_types import ArtifactKind, definition_for
from .validator import validate_artifact_text, validate_template


class GenerationError(RuntimeError):
    """Raised when an artifact cannot be generated safely."""


def slugify(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()


def next_numeric_id(directory: Path, prefix: str) -> int:
    numbers: list[int] = []
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d{{4}})-")
    if directory.exists():
        for path in directory.glob(f"{prefix}-*.md"):
            match = pattern.match(path.name)
            if match:
                numbers.append(int(match.group(1)))
    return max(numbers, default=0) + 1


def _atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as temporary:
            temporary_path = Path(temporary.name)
            temporary.write(content)
            temporary.flush()
            os.fsync(temporary.fileno())
        os.replace(temporary_path, path)
        temporary_path = None
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def generate_artifact(
    root: Path,
    kind: ArtifactKind,
    title: str,
    *,
    today: date | None = None,
) -> Path:
    definition = definition_for(kind)
    normalized_title = title.strip()
    slug = slugify(normalized_title)
    if not slug:
        raise GenerationError("title must contain at least one ASCII letter or digit")

    template_failures = validate_template(root, definition)
    if template_failures:
        messages = "; ".join(failure.message for failure in template_failures)
        raise GenerationError(f"invalid {kind.value} template: {messages}")

    try:
        template = (root / definition.template).read_text(encoding="utf-8")
    except OSError as error:
        raise GenerationError(f"cannot read template {definition.template}: {error}") from error

    number = next_numeric_id(root / definition.destination, definition.prefix)
    artifact_id = f"{definition.prefix}-{number:04d}"
    destination = root / definition.destination / f"{artifact_id}-{slug}.md"
    if destination.exists():
        raise GenerationError(
            f"destination already exists: {destination.relative_to(root).as_posix()}"
        )

    values = {
        "id": artifact_id,
        "title": normalized_title,
        "status": definition.initial_status,
        "owner": "unassigned",
        "date": (today or date.today()).isoformat(),
    }
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace(f"{{{{ {key} }}}}", value)
    if re.search(r"{{[^}]+}}", rendered):
        raise GenerationError("template contains unresolved placeholders")
    if not rendered.endswith("\n"):
        rendered += "\n"

    relative_path = destination.relative_to(root)
    failures = validate_artifact_text(rendered, definition, relative_path)
    if failures:
        messages = "; ".join(failure.message for failure in failures)
        raise GenerationError(f"generated artifact is invalid: {messages}")

    try:
        _atomic_write(destination, rendered)
    except OSError as error:
        raise GenerationError(f"cannot write {relative_path.as_posix()}: {error}") from error
    return destination
