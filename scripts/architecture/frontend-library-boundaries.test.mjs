import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyFrontendLibraryBoundaries } from "./frontend-library-boundaries.mjs";

async function writeFixture(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

test("accepts exact catalog versions and permitted form imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "booking-os-frontend-"));

  await writeFixture(
    root,
    "pnpm-workspace.yaml",
    ["catalog:", "  tailwindcss: 4.3.3", "  react-hook-form: 7.83.0", "  zod: 4.4.3", ""].join(
      "\n",
    ),
  );
  await writeFixture(
    root,
    "apps/web-console/src/form.tsx",
    'import { useForm } from "react-hook-form";\nexport { useForm };\n',
  );

  assert.deepEqual(await verifyFrontendLibraryBoundaries(root), []);
});

test("rejects ranges and direct axios imports in applications", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "booking-os-frontend-"));

  await writeFixture(root, "pnpm-workspace.yaml", "catalog:\n  tailwindcss: ^4.3.3\n");
  await writeFixture(
    root,
    "apps/web-console/src/bad.ts",
    'import axios from "axios";\nexport default axios;\n',
  );

  const violations = await verifyFrontendLibraryBoundaries(root);
  assert.equal(
    violations.some((item) => item.includes("exact version")),
    true,
  );
  assert.equal(
    violations.some((item) => item.includes("direct axios import")),
    true,
  );
});
