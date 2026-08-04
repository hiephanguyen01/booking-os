from pathlib import Path
import unittest

from tools.genesis.artifact_types import ArtifactKind, classify_artifact, definition_for


class ArtifactDefinitionTest(unittest.TestCase):
    def test_definitions_freeze_destinations_ids_and_lifecycles(self) -> None:
        adr = definition_for(ArtifactKind.ADR)
        self.assertEqual(adr.destination, Path("docs/adr"))
        self.assertEqual(adr.prefix, "ADR")
        self.assertEqual(adr.initial_status, "proposed")
        self.assertEqual(adr.completed_statuses, frozenset({"accepted"}))
        self.assertEqual(adr.historical_statuses, frozenset({"superseded", "rejected"}))

        feature = definition_for(ArtifactKind.FEATURE)
        self.assertEqual(feature.destination, Path("docs/features"))
        self.assertEqual(feature.prefix, "FEATURE")
        self.assertEqual(feature.initial_status, "draft")

        pattern = definition_for(ArtifactKind.PATTERN)
        self.assertEqual(pattern.destination, Path("docs/patterns"))
        self.assertEqual(pattern.prefix, "PATTERN")
        self.assertEqual(pattern.initial_status, "draft")

    def test_templates_are_not_classified_as_real_artifacts(self) -> None:
        self.assertIsNone(classify_artifact(Path("genesis/templates/ADR.md")))
        self.assertEqual(
            classify_artifact(Path("docs/adr/ADR-0002-example.md")),
            ArtifactKind.ADR,
        )


if __name__ == "__main__":
    unittest.main()
