import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { modules as configuredModules } from "./api-module-manifest.mjs";

const DOMAIN_FORBIDDEN = [
  "@nestjs/",
  "@prisma/client",
  "express",
  "fastify",
  "bullmq",
  "ioredis",
  "pg",
];
const APPLICATION_FORBIDDEN = DOMAIN_FORBIDDEN;
const PORT_FORBIDDEN_TYPES = [
  "Prisma.",
  "TransactionClient",
  "PrismaClient",
  "Request<",
  "Response<",
  "Job<",
];
const IMPORT_PATTERN =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s*)?["']([^"']+)["']/g;

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function isInside(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function packageIsForbidden(specifier, forbiddenPrefixes) {
  return forbiddenPrefixes.some((prefix) =>
    prefix.endsWith("/") ? specifier.startsWith(prefix) : specifier === prefix,
  );
}

function importedSpecifiers(source) {
  return [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1]);
}

function zoneFor(filePath, moduleRoot) {
  const relative = toPosix(path.relative(moduleRoot, filePath));
  if (relative === "domain" || relative.startsWith("domain/")) return "domain";
  if (relative === "application" || relative.startsWith("application/")) return "application";
  if (relative === "infrastructure" || relative.startsWith("infrastructure/")) {
    return "infrastructure";
  }
  return "composition";
}

function resolveRelativeImport(filePath, specifier) {
  if (!specifier.startsWith(".")) return undefined;
  const resolved = path.resolve(path.dirname(filePath), specifier);
  return resolved.replace(/\.(?:mjs|cjs|js|jsx|ts|tsx)$/, "");
}

function moduleForPath(candidatePath, definitions) {
  return definitions.find((definition) => isInside(candidatePath, definition.absoluteRoot));
}

async function collectTypeScriptFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        files.push(entryPath);
      }
    }
  }

  await visit(root);
  return files.sort();
}

async function unregisteredModuleFailures(repositoryRoot, definitions) {
  const modulesRoot = path.join(repositoryRoot, "apps/api/src/modules");
  if (!existsSync(modulesRoot)) return [];

  const entries = await readdir(modulesRoot, { withFileTypes: true });
  const registeredRoots = new Set(
    definitions.map((definition) => path.resolve(definition.absoluteRoot)),
  );
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(modulesRoot, entry.name))
    .filter((moduleRoot) => !registeredRoots.has(path.resolve(moduleRoot)))
    .map(
      (moduleRoot) =>
        `${toPosix(path.relative(repositoryRoot, moduleRoot))}: module directory is not registered in api-module-manifest.mjs`,
    );
}

function validateImport({
  filePath,
  moduleDefinition,
  zone,
  specifier,
  definitions,
  repositoryRoot,
}) {
  const failures = [];
  const relativeFile = toPosix(path.relative(repositoryRoot, filePath));

  if (zone === "domain" && packageIsForbidden(specifier, DOMAIN_FORBIDDEN)) {
    failures.push(`${relativeFile}: domain must not import forbidden package ${specifier}`);
  }
  if (zone === "application" && packageIsForbidden(specifier, APPLICATION_FORBIDDEN)) {
    failures.push(`${relativeFile}: application must not import forbidden package ${specifier}`);
  }

  const resolvedImport = resolveRelativeImport(filePath, specifier);
  if (!resolvedImport) return failures;

  const importedModule = moduleForPath(resolvedImport, definitions);
  if (importedModule && importedModule.name !== moduleDefinition.name) {
    const importedZone = zoneFor(resolvedImport, importedModule.absoluteRoot);
    if (importedZone === "infrastructure") {
      failures.push(
        `${relativeFile}: cross-module infrastructure import is forbidden (${specifier})`,
      );
    }
  }

  if (zone === "domain") {
    if (!isInside(resolvedImport, path.join(moduleDefinition.absoluteRoot, "domain"))) {
      failures.push(
        `${relativeFile}: domain may import only same-module domain files (${specifier})`,
      );
    }
  }

  if (
    zone === "application" &&
    isInside(resolvedImport, path.join(moduleDefinition.absoluteRoot, "infrastructure"))
  ) {
    failures.push(`${relativeFile}: application must not import infrastructure (${specifier})`);
  }

  return failures;
}

export async function verifyApiModuleBoundaries({ repositoryRoot, modules }) {
  const definitions = modules.map((moduleDefinition) => ({
    ...moduleDefinition,
    absoluteRoot: path.resolve(repositoryRoot, moduleDefinition.root),
  }));
  const failures = await unregisteredModuleFailures(repositoryRoot, definitions);

  for (const moduleDefinition of definitions) {
    if (!existsSync(moduleDefinition.absoluteRoot)) {
      failures.push(`${toPosix(moduleDefinition.root)}: registered module root does not exist`);
      continue;
    }
    const rootStats = await stat(moduleDefinition.absoluteRoot);
    if (!rootStats.isDirectory()) {
      failures.push(`${toPosix(moduleDefinition.root)}: registered module root is not a directory`);
      continue;
    }

    for (const filePath of await collectTypeScriptFiles(moduleDefinition.absoluteRoot)) {
      const source = await readFile(filePath, "utf8");
      const zone = zoneFor(filePath, moduleDefinition.absoluteRoot);
      for (const specifier of importedSpecifiers(source)) {
        failures.push(
          ...validateImport({
            filePath,
            moduleDefinition,
            zone,
            specifier,
            definitions,
            repositoryRoot,
          }),
        );
      }

      if (zone === "application" && toPosix(filePath).includes("/ports/")) {
        const relativeFile = toPosix(path.relative(repositoryRoot, filePath));
        for (const forbiddenType of PORT_FORBIDDEN_TYPES) {
          if (source.includes(forbiddenType)) {
            failures.push(
              `${relativeFile}: application port contains forbidden technology type ${forbiddenType}`,
            );
          }
        }
      }
    }
  }

  return [...new Set(failures)].sort();
}

async function main() {
  const failures = await verifyApiModuleBoundaries({
    repositoryRoot: process.cwd(),
    modules: configuredModules,
  });

  if (failures.length > 0) {
    for (const failure of failures) console.error(failure);
    process.exitCode = 1;
    return;
  }

  console.log("API module boundary verification PASS.");
}

const executedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (executedPath === import.meta.url) {
  await main();
}
