import unittest

from tools.genesis.frontmatter import FrontmatterError, parse_frontmatter, render_frontmatter


class FrontmatterTest(unittest.TestCase):
    def test_round_trips_ordered_scalar_metadata(self) -> None:
        source = (
            "---\n"
            "id: ADR-0002\n"
            "title: Example\n"
            "status: accepted\n"
            "owner: owner\n"
            "date: 2026-08-04\n"
            "---\n\n"
            "# Example\n"
        )
        parsed = parse_frontmatter(source)
        self.assertEqual(parsed.metadata["id"], "ADR-0002")
        self.assertEqual(parsed.body, "# Example\n")
        self.assertEqual(render_frontmatter(parsed.metadata, parsed.body), source)

    def test_rejects_missing_and_duplicate_frontmatter_keys(self) -> None:
        with self.assertRaisesRegex(FrontmatterError, "missing opening"):
            parse_frontmatter("# No metadata\n")
        with self.assertRaisesRegex(FrontmatterError, "duplicate front matter key: id"):
            parse_frontmatter("---\nid: A\nid: B\n---\n\nBody\n")


if __name__ == "__main__":
    unittest.main()
