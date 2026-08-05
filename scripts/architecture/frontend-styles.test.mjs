import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(file, "utf8");

test("console configures Tailwind and scans shared UI", async () => {
  const [postcss, globals] = await Promise.all([
    read("apps/web-console/postcss.config.mjs"),
    read("apps/web-console/app/globals.css"),
  ]);

  assert.match(postcss, /@tailwindcss\/postcss/);
  assert.match(globals, /@import\s+["']tailwindcss["']/);
  assert.match(globals, /@import\s+["']@booking-os\/ui\/styles\.css["']/);
  assert.match(globals, /@source\s+["'][^"']*packages\/ui\/src/);
});

test("shared styles contain semantic tokens", async () => {
  const tokens = await read("packages/ui/src/styles/tokens.css");

  for (const token of [
    "--background",
    "--foreground",
    "--primary",
    "--destructive",
    "--border",
    "--ring",
  ]) {
    assert.equal(tokens.includes(token), true, `missing ${token}`);
  }
});
