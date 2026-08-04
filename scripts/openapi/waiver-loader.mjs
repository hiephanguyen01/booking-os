import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import { parse } from "yaml";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(moduleDirectory, "../../schemas/openapi-compatibility-waiver.schema.json");
const schema = JSON.parse(await readFile(schemaPath, "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateWaiver = ajv.compile(schema);

export class WaiverError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "WaiverError";
  }
}

function parseDateOnly(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new WaiverError(`${label} is not a valid UTC date: ${String(value)}`);
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const timestamp = Date.UTC(year, month - 1, day);
  const roundTrip = new Date(timestamp).toISOString().slice(0, 10);

  if (roundTrip !== value) {
    throw new WaiverError(`${label} is an invalid UTC date: ${value}`);
  }

  return timestamp;
}

function schemaErrors() {
  return (validateWaiver.errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function freezeWaiver(document) {
  const findings = Object.freeze(document.findings.map((finding) => Object.freeze({ ...finding })));
  return Object.freeze({ ...document, findings });
}

export async function sha256File(path) {
  const contents = await readFile(path);
  return createHash("sha256").update(contents).digest("hex");
}

export async function loadWaivers(directory, { today }) {
  const currentDate = parseDateOnly(today, "today");
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".yaml"))
    .map((entry) => entry.name)
    .sort();
  const seenIds = new Set();
  const waivers = [];

  for (const filename of files) {
    const path = join(directory, filename);
    let document;
    try {
      document = parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new WaiverError(`${filename} YAML parse failed`, { cause: error });
    }

    if (!validateWaiver(document)) {
      throw new WaiverError(`${filename} schema validation failed: ${schemaErrors()}`);
    }

    if (seenIds.has(document.id)) {
      throw new WaiverError(`duplicate waiver id: ${document.id}`);
    }
    seenIds.add(document.id);

    const expiry = parseDateOnly(document.expiresOn, `${filename}.expiresOn`);
    if (expiry <= currentDate) {
      throw new WaiverError(`${document.id} expired on ${document.expiresOn}`);
    }

    waivers.push(freezeWaiver(document));
  }

  return Object.freeze(waivers);
}
