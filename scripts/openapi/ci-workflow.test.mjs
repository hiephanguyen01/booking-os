import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(".github/workflows/ci.yml", "utf8");

const requiredFragments = [
  "name: OpenAPI compatibility",
  "if: github.event_name == 'pull_request'",
  "fetch-depth: 0",
  'go-version: "1.26.x"',
  "cache: false",
  "go install github.com/oasdiff/oasdiff@v1.17.0",
  "github.event.pull_request.base.sha",
  "git show",
  "packages/contracts/openapi/openapi.json",
  "pnpm api:verify-compatibility-fixtures",
  "pnpm api:check-breaking",
];

test("CI contains a fail-closed pull-request OpenAPI compatibility gate", () => {
  for (const fragment of requiredFragments) {
    assert.match(workflow, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.doesNotMatch(workflow, /OpenAPI compatibility[\s\S]*continue-on-error:/);
});
