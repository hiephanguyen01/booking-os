import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadWaivers, sha256File, WaiverError } from "./waiver-loader.mjs";

const EXIT_COMPATIBLE = 0;
const EXIT_BREAKING = 1;
const EXIT_CONFIGURATION = 2;
const FINDING_PATTERN = /^(ERR|WARN|error|warning)\s/;
const SUMMARY_PATTERN = /^\d+\s+changes?:/i;
const NO_CHANGES_PATTERN = /^No (?:breaking )?changes/i;

class CompatibilityError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "CompatibilityError";
  }
}

async function readOpenApiDocument(path, label) {
  let document;
  try {
    document = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new CompatibilityError(`${label} contract is not valid JSON: ${path}`, { cause: error });
  }

  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document) ||
    typeof document.openapi !== "string" ||
    !document.openapi.startsWith("3.") ||
    document.paths === null ||
    typeof document.paths !== "object" ||
    Array.isArray(document.paths)
  ) {
    throw new CompatibilityError(
      `${label} contract is not a supported OpenAPI 3 document: ${path}`,
    );
  }

  return document;
}

function executeOasdiff(binary, args) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    env: process.env,
  });

  if (result.error) {
    throw new CompatibilityError(`unable to execute oasdiff: ${result.error.message}`, {
      cause: result.error,
    });
  }
  if (result.status === null) {
    throw new CompatibilityError(
      `oasdiff terminated without an exit code${result.signal ? ` (${result.signal})` : ""}`,
    );
  }
  return result;
}

function normalizeSeverity(value) {
  if (value === "ERR" || value === "error") {
    return "ERR";
  }
  if (value === "WARN" || value === "warning") {
    return "WARN";
  }
  throw new CompatibilityError(`unsupported oasdiff severity: ${value}`);
}

function parseRawFindings(output) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const findings = [];
  let ignoredSummary = false;

  for (const line of lines) {
    const match = FINDING_PATTERN.exec(line);
    if (match) {
      findings.push(Object.freeze({ severity: normalizeSeverity(match[1]), fingerprint: line }));
      continue;
    }

    if (!ignoredSummary && (SUMMARY_PATTERN.test(line) || NO_CHANGES_PATTERN.test(line))) {
      ignoredSummary = true;
      continue;
    }

    throw new CompatibilityError(`unparseable oasdiff finding: ${line}`);
  }

  return Object.freeze(findings);
}

function selectWaivedFindings(waivers, baseHash, revisionHash, rawFindings) {
  const selected = waivers.filter(
    (waiver) =>
      waiver.baseContractSha256 === baseHash && waiver.revisionContractSha256 === revisionHash,
  );
  const rawByFingerprint = new Map(
    rawFindings.map((finding) => [finding.fingerprint, finding.severity]),
  );
  const claimedBy = new Map();
  const waived = [];

  for (const waiver of selected) {
    for (const finding of waiver.findings) {
      const rawSeverity = rawByFingerprint.get(finding.fingerprint);
      if (rawSeverity === undefined) {
        throw new CompatibilityError(
          `${waiver.id} finding is absent from the raw oasdiff report: ${finding.fingerprint}`,
        );
      }
      if (rawSeverity !== finding.severity) {
        throw new CompatibilityError(
          `${waiver.id} severity ${finding.severity} does not match raw severity ${rawSeverity}: ${finding.fingerprint}`,
        );
      }
      const existingOwner = claimedBy.get(finding.fingerprint);
      if (existingOwner !== undefined) {
        throw new CompatibilityError(
          `${finding.fingerprint} is claimed by both ${existingOwner} and ${waiver.id}`,
        );
      }
      claimedBy.set(finding.fingerprint, waiver.id);
      waived.push(finding);
    }
  }

  return Object.freeze(waived);
}

async function createIgnoreArguments(findings) {
  if (findings.length === 0) {
    return {
      args: Object.freeze([]),
      cleanup: async () => {},
    };
  }

  const directory = await mkdtemp(join(tmpdir(), "booking-os-oasdiff-ignore-"));
  const args = [];
  const errors = findings
    .filter((finding) => finding.severity === "ERR")
    .map((finding) => finding.fingerprint);
  const warnings = findings
    .filter((finding) => finding.severity === "WARN")
    .map((finding) => finding.fingerprint);

  if (errors.length > 0) {
    const path = join(directory, "errors.txt");
    await writeFile(path, `${errors.join("\n")}\n`, "utf8");
    args.push("--err-ignore", path);
  }
  if (warnings.length > 0) {
    const path = join(directory, "warnings.txt");
    await writeFile(path, `${warnings.join("\n")}\n`, "utf8");
    args.push("--warn-ignore", path);
  }

  return {
    args: Object.freeze(args),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function run() {
  const [basePath, revisionPath, waiverDirectory = "docs/api/compatibility-waivers"] =
    process.argv.slice(2);
  if (!basePath || !revisionPath || process.argv.slice(2).length > 3) {
    throw new CompatibilityError(
      "usage: node scripts/openapi/check-breaking.mjs <base.json> <revision.json> [waiver-directory]",
    );
  }

  await Promise.all([
    readOpenApiDocument(basePath, "base"),
    readOpenApiDocument(revisionPath, "revision"),
  ]);
  const [baseHash, revisionHash] = await Promise.all([
    sha256File(basePath),
    sha256File(revisionPath),
  ]);
  const today = process.env.OPENAPI_WAIVER_TODAY ?? new Date().toISOString().slice(0, 10);
  const waivers = await loadWaivers(waiverDirectory, { today });
  const binary = process.env.OASDIFF_BIN ?? "oasdiff";
  const raw = executeOasdiff(binary, [
    "breaking",
    "-f",
    "singleline",
    "--color",
    "never",
    basePath,
    revisionPath,
  ]);

  if (raw.status !== 0 && raw.status !== 1) {
    throw new CompatibilityError(
      `unexpected oasdiff exit code ${raw.status} during raw comparison`,
    );
  }
  const rawFindings = parseRawFindings(raw.stdout);
  if (raw.status === 1 && rawFindings.length === 0) {
    throw new CompatibilityError(
      `oasdiff returned exit code 1 without parseable findings${raw.stderr ? `: ${raw.stderr.trim()}` : ""}`,
    );
  }

  const waivedFindings = selectWaivedFindings(waivers, baseHash, revisionHash, rawFindings);
  const ignore = await createIgnoreArguments(waivedFindings);

  try {
    const filtered = executeOasdiff(binary, [
      "breaking",
      "--fail-on",
      "WARN",
      "--color",
      "never",
      ...ignore.args,
      basePath,
      revisionPath,
    ]);

    if (filtered.status === 0) {
      return EXIT_COMPATIBLE;
    }
    if (filtered.status === 1) {
      const details = filtered.stdout.trim();
      console.error(
        `unwaived OpenAPI compatibility findings remain${details ? `:\n${details}` : ""}`,
      );
      return EXIT_BREAKING;
    }
    throw new CompatibilityError(
      `unexpected oasdiff exit code ${filtered.status} during filtered comparison`,
    );
  } finally {
    await ignore.cleanup();
  }
}

try {
  process.exitCode = await run();
} catch (error) {
  const message =
    error instanceof CompatibilityError || error instanceof WaiverError
      ? error.message
      : `unexpected compatibility-check failure: ${error instanceof Error ? error.message : String(error)}`;
  console.error(message);
  process.exitCode = EXIT_CONFIGURATION;
}
