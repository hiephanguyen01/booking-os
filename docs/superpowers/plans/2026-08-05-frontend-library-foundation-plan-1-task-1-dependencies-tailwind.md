# Plan 1 — Task 1: Dependency Governance and Tailwind

**Consumes:** repository state at the plan branch head.

**Produces:** exact catalog dependencies, `verify:frontend-libraries`, `@booking-os/ui/styles.css`, and semantic Tailwind utilities.

## Task 1.1: Pin Dependencies and Add the Boundary Gate

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `packages/contracts/package.json`
- Modify: `packages/api-client/package.json`
- Modify: `packages/ui/package.json`
- Modify: `apps/web-console/package.json`
- Create: `scripts/architecture/frontend-library-boundaries.mjs`
- Create: `scripts/architecture/frontend-library-boundaries.test.mjs`
- Modify: `pnpm-lock.yaml` using pnpm

- [ ] **Step 1: Write the failing boundary test**

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyFrontendLibraryBoundaries } from "./frontend-library-boundaries.mjs";

async function writeFixture(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

test("accepts exact catalog values and permitted form imports", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "booking-os-frontend-"));
  await writeFixture(root, "pnpm-workspace.yaml", [
    "catalog:",
    "  tailwindcss: 4.3.3",
    "  react-hook-form: 7.83.0",
    "  zod: 4.4.3",
    "",
  ].join("\n"));
  await writeFixture(root, "apps/web-console/src/form.tsx", 'import { useForm } from "react-hook-form";\nexport { useForm };\n');
  assert.deepEqual(await verifyFrontendLibraryBoundaries(root), []);
});

test("rejects ranges and direct axios imports in applications", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "booking-os-frontend-"));
  await writeFixture(root, "pnpm-workspace.yaml", "catalog:\n  tailwindcss: ^4.3.3\n");
  await writeFixture(root, "apps/web-console/src/bad.ts", 'import axios from "axios";\nexport default axios;\n');
  const violations = await verifyFrontendLibraryBoundaries(root);
  assert.equal(violations.some((value) => value.includes("exact version")), true);
  assert.equal(violations.some((value) => value.includes("direct axios import")), true);
});
```

- [ ] **Step 2: Run RED**

```bash
node --test scripts/architecture/frontend-library-boundaries.test.mjs
```

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `frontend-library-boundaries.mjs`.

- [ ] **Step 3: Implement the verifier**

```js
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
  const workspace = await readFile(path.join(rootDir, "pnpm-workspace.yaml"), "utf8").catch(() => "");
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
      violations.push(`catalog dependency ${match[1]} must use an exact version; received ${match[2]}`);
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
```

- [ ] **Step 4: Add exact catalog values**

```yaml
  "@hookform/resolvers": 5.5.7
  "@tailwindcss/postcss": 4.3.3
  "@testing-library/dom": 10.4.1
  "@testing-library/react": 16.3.2
  "@testing-library/user-event": 14.6.1
  class-variance-authority: 0.7.1
  clsx: 2.1.1
  jsdom: 29.1.1
  postcss: 8.5.18
  react-hook-form: 7.83.0
  tailwind-merge: 3.6.0
  tailwindcss: 4.3.3
  vitest: 4.1.10
  zod: 4.4.3
```

Apply ownership:

```text
packages/contracts dependencies:
  zod: catalog:

packages/api-client dependencies:
  zod: catalog:                 # replace direct 4.4.3

packages/ui dependencies:
  class-variance-authority: catalog:
  clsx: catalog:
  tailwind-merge: catalog:

packages/ui devDependencies:
  vitest: catalog:              # replace direct 4.1.10

apps/web-console dependencies:
  @booking-os/contracts: workspace:*
  @hookform/resolvers: catalog:
  react-hook-form: catalog:

apps/web-console devDependencies:
  @tailwindcss/postcss: catalog:
  @testing-library/dom: catalog:
  @testing-library/react: catalog:
  @testing-library/user-event: catalog:
  jsdom: catalog:
  postcss: catalog:
  tailwindcss: catalog:
  vitest: catalog:
```

Add root script:

```json
"verify:frontend-libraries": "node scripts/architecture/frontend-library-boundaries.mjs"
```

- [ ] **Step 5: Run GREEN**

```bash
pnpm install --lockfile-only
node --test scripts/architecture/frontend-library-boundaries.test.mjs
pnpm verify:frontend-libraries
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml packages/contracts/package.json packages/api-client/package.json packages/ui/package.json apps/web-console/package.json scripts/architecture/frontend-library-boundaries.mjs scripts/architecture/frontend-library-boundaries.test.mjs
git commit -m "build(frontend): govern UI and form dependencies"
```

## Task 1.2: Add Tailwind and Semantic Tokens

**Files:**
- Create: `apps/web-console/postcss.config.mjs`
- Create: `packages/ui/src/styles/tokens.css`
- Create: `packages/ui/src/styles/base.css`
- Create: `packages/ui/src/styles/index.css`
- Modify: `packages/ui/package.json`
- Replace: `apps/web-console/app/globals.css`
- Create: `scripts/architecture/frontend-styles.test.mjs`

- [ ] **Step 1: Write the failing style contract**

```js
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
  for (const token of ["--background", "--foreground", "--primary", "--destructive", "--border", "--ring"]) {
    assert.equal(tokens.includes(token), true, `missing ${token}`);
  }
});
```

- [ ] **Step 2: Run RED**

```bash
node --test scripts/architecture/frontend-styles.test.mjs
```

Expected: FAIL with `ENOENT` for `postcss.config.mjs`.

- [ ] **Step 3: Implement PostCSS and styles**

```js
export default { plugins: { "@tailwindcss/postcss": {} } };
```

```css
/* packages/ui/src/styles/tokens.css */
:root {
  --background: oklch(0.985 0.004 250);
  --foreground: oklch(0.22 0.025 255);
  --card: oklch(1 0 0);
  --card-foreground: var(--foreground);
  --primary: oklch(0.48 0.17 258);
  --primary-foreground: oklch(0.985 0.004 250);
  --secondary: oklch(0.94 0.01 255);
  --secondary-foreground: oklch(0.3 0.03 255);
  --muted: oklch(0.95 0.008 255);
  --muted-foreground: oklch(0.5 0.025 255);
  --destructive: oklch(0.56 0.2 27);
  --destructive-foreground: oklch(0.985 0.004 250);
  --success: oklch(0.55 0.15 150);
  --border: oklch(0.88 0.012 255);
  --input: var(--border);
  --ring: oklch(0.58 0.15 258);
  --radius: 0.75rem;
}
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-md: var(--radius);
}
```

```css
/* packages/ui/src/styles/base.css */
* { border-color: var(--border); }
body { background: var(--background); color: var(--foreground); font-family: Arial, Helvetica, sans-serif; text-rendering: optimizeLegibility; }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
```

```css
/* packages/ui/src/styles/index.css */
@import "./tokens.css";
@import "./base.css";
```

Add export:

```json
"./styles.css": "./src/styles/index.css"
```

Replace console globals:

```css
@import "tailwindcss";
@import "@booking-os/ui/styles.css";
@source "../../../packages/ui/src/**/*.{ts,tsx}";
html, body { min-height: 100%; }
body { margin: 0; }
```

- [ ] **Step 4: Run GREEN**

```bash
node --test scripts/architecture/frontend-styles.test.mjs
pnpm --filter @booking-os/web-console build
```

- [ ] **Step 5: Commit**

```bash
git add apps/web-console/postcss.config.mjs apps/web-console/app/globals.css packages/ui/src/styles packages/ui/package.json scripts/architecture/frontend-styles.test.mjs
git commit -m "feat(ui): establish Tailwind semantic tokens"
```
