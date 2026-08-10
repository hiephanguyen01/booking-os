#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const FINDING_CLASSIFICATIONS = Object.freeze([
  "CONFLICT",
  "STALE_METADATA",
  "ROADMAP_GAP",
  "EXPECTED_INCOMPLETE",
  "MISSING_IMPLEMENTATION",
]);

const REQUIRED_FIELDS = Object.freeze([
  "Plan Status",
  "Current Task",
  "Classification",
  "Required Now",
  "Evidence",
]);

function readField(content, field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${escaped}:\\s*(.+)$`, "im").exec(content);
  return match?.[1]?.trim() ?? "";
}

export function validateReconciliationContent(content, source = "checkpoint") {
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (!readField(content, field)) errors.push(`${source}: missing ${field}`);
  }

  const classification = readField(content, "Classification");
  if (classification && !FINDING_CLASSIFICATIONS.includes(classification)) {
    errors.push(
      `${source}: unsupported Classification ${classification}; expected one of ${FINDING_CLASSIFICATIONS.join(", ")}`,
    );
  }

  const requiredNow = readField(content, "Required Now").toUpperCase();
  if (requiredNow && requiredNow !== "YES" && requiredNow !== "NO") {
    errors.push(`${source}: Required Now must be YES or NO`);
  }

  return errors;
}

async function validateFile(path) {
  const content = await readFile(path, "utf8");
  return validateReconciliationContent(content, path);
}

async function reconciliationFiles(repositoryRoot) {
  const directory = join(repositoryRoot, "docs", "superpowers", "checkpoints");
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  return entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".md") &&
        entry.name.toLowerCase().includes("reconciliation"),
    )
    .map((entry) => join(directory, entry.name))
    .sort();
}

export async function main(argv = process.argv.slice(2)) {
  const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  let files;

  if (argv[0] === "--file") {
    if (!argv[1]) {
      console.error("--file requires a checkpoint path");
      return 2;
    }
    files = [resolve(repositoryRoot, argv[1])];
  } else if (argv.length > 0) {
    console.error(`Unsupported arguments: ${argv.join(" ")}`);
    return 2;
  } else {
    files = await reconciliationFiles(repositoryRoot);
  }

  const errors = [];
  for (const file of files) errors.push(...(await validateFile(file)));

  if (errors.length > 0) {
    for (const error of errors) console.error(error);
    return 1;
  }

  console.log(`Delivery reconciliation validation passed (${files.length} checkpoint${files.length === 1 ? "" : "s"}).`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
