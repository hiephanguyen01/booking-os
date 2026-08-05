import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);
const IGNORED = new Set([".git", ".next", ".turbo", "dist", "node_modules"]);

async function collectSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectSourceFiles(absolute)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(absolute);
  }

  return files;
}

const isExactVersion = (value) => /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(value);

export async function verifyFrontendLibraryBoundaries(rootDir) {
  const violations = [];
  const workspace = await readFile(path.join(rootDir, "pnpm-workspace.yaml"), "utf8").catch(
    () => "",
  );
  let insideCatalog = false;

  for (const line of workspace.split("\n")) {
    if (line === "catalog:") {
      insideCatalog = true;
      continue;
    }
    if (insideCatalog && line && !line.startsWith("  ")) insideCatalog = false;
    if (!insideCatalog) continue;

    const match = line.match(/^\s{2}["']?(.+?)["']?:\s*["']?([^"']+)["']?\s*$/);
    if (match && !isExactVersion(match[2])) {
      violations.push(
        `catalog dependency ${match[1]} must use an exact version; received ${match[2]}`,
      );
    }
  }

  for (const app of ["apps/web-console", "apps/web-storefront"]) {
    for (const file of await collectSourceFiles(path.join(rootDir, app))) {
      const source = await readFile(file, "utf8");
      if (/from\s+["']axios["']|import\s*\(["']axios["']\)/.test(source)) {
        violations.push(`${path.relative(rootDir, file)} contains a direct axios import`);
      }
    }
  }

  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = await verifyFrontendLibraryBoundaries(process.cwd());
  if (violations.length) {
    console.error(violations.join("\n"));
    process.exitCode = 1;
  }
}
