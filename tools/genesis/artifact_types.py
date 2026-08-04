"""Definitions for canonical Genesis artifact types."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path


class ArtifactKind(str, Enum):
    ADR = "ADR"
    FEATURE = "FEATURE"
    PATTERN = "PATTERN"


@dataclass(frozen=True)
class ArtifactDefinition:
    kind: ArtifactKind
    prefix: str
    destination: Path
    template: Path
    initial_status: str
    draft_statuses: frozenset[str]
    completed_statuses: frozenset[str]
    historical_statuses: frozenset[str]
    required_sections: tuple[str, ...]

    @property
    def allowed_statuses(self) -> frozenset[str]:
        return self.draft_statuses | self.completed_statuses | self.historical_statuses


DEFINITIONS: dict[ArtifactKind, ArtifactDefinition] = {
    ArtifactKind.ADR: ArtifactDefinition(
        kind=ArtifactKind.ADR,
        prefix="ADR",
        destination=Path("docs/adr"),
        template=Path("genesis/templates/ADR.md"),
        initial_status="proposed",
        draft_statuses=frozenset({"proposed"}),
        completed_statuses=frozenset({"accepted"}),
        historical_statuses=frozenset({"superseded", "rejected"}),
        required_sections=(
            "Context",
            "Problem",
            "Options Considered",
            "Decision",
            "Trade-offs",
            "Consequences",
            "Validation",
            "References",
        ),
    ),
    ArtifactKind.FEATURE: ArtifactDefinition(
        kind=ArtifactKind.FEATURE,
        prefix="FEATURE",
        destination=Path("docs/features"),
        template=Path("genesis/templates/FEATURE.md"),
        initial_status="draft",
        draft_statuses=frozenset({"draft"}),
        completed_statuses=frozenset({"active"}),
        historical_statuses=frozenset({"deprecated"}),
        required_sections=(
            "Problem",
            "Goal",
            "Non-goals",
            "Business Rules",
            "Acceptance Criteria",
            "Test Plan",
        ),
    ),
    ArtifactKind.PATTERN: ArtifactDefinition(
        kind=ArtifactKind.PATTERN,
        prefix="PATTERN",
        destination=Path("docs/patterns"),
        template=Path("genesis/templates/PATTERN.md"),
        initial_status="draft",
        draft_statuses=frozenset({"draft"}),
        completed_statuses=frozenset({"active"}),
        historical_statuses=frozenset({"deprecated"}),
        required_sections=(
            "Problem",
            "Context",
            "Solution",
            "Trade-offs",
            "Review Checklist",
        ),
    ),
}


def definition_for(kind: ArtifactKind) -> ArtifactDefinition:
    return DEFINITIONS[kind]


def classify_artifact(path: Path) -> ArtifactKind | None:
    if path.suffix.lower() != ".md":
        return None

    for kind, definition in DEFINITIONS.items():
        if path.parent.name == definition.destination.name and path.name.startswith(
            f"{definition.prefix}-"
        ):
            return kind
    return None
