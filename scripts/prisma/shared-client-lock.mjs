import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_RETRY_DELAY_MS = 50;
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_STALE_AFTER_MS = 120_000;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer.`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function assertFunction(value, label) {
  if (typeof value !== "function") {
    throw new TypeError(`${label} must be a function.`);
  }
}

function isFileSystemError(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

async function removeStaleLock(lockPath, staleAfterMs) {
  try {
    const lock = await stat(lockPath);
    if (Date.now() - lock.mtimeMs <= staleAfterMs) {
      return false;
    }
    await rm(lockPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) {
      return true;
    }
    throw error;
  }
}

async function acquireDirectoryLock(lockPath, options) {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const deadline = Date.now() + options.timeoutMs;

  while (true) {
    try {
      await mkdir(lockPath);
      return;
    } catch (error) {
      if (!isFileSystemError(error, "EEXIST")) {
        throw error;
      }

      if (await removeStaleLock(lockPath, options.staleAfterMs)) {
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for shared Prisma client generation.");
      }
      await delay(options.retryDelayMs);
    }
  }
}

async function markerMatches(markerPath, fingerprint) {
  try {
    return (await readFile(markerPath, "utf8")).trim() === fingerprint;
  } catch (error) {
    if (isFileSystemError(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

export async function withDirectoryLock(lockPath, work, options = {}) {
  if (typeof lockPath !== "string" || lockPath.trim().length === 0) {
    throw new TypeError("Directory lock path must be a non-empty string.");
  }
  if (typeof work !== "function") {
    throw new TypeError("Directory lock work must be a function.");
  }

  const resolvedOptions = {
    retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    staleAfterMs: options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS,
  };
  assertPositiveInteger(resolvedOptions.retryDelayMs, "Directory lock retry delay");
  assertPositiveInteger(resolvedOptions.timeoutMs, "Directory lock timeout");
  assertPositiveInteger(resolvedOptions.staleAfterMs, "Directory lock stale threshold");

  await acquireDirectoryLock(lockPath, resolvedOptions);
  try {
    return await work();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

export async function ensureGeneratedArtifact({
  lockPath,
  markerPath,
  fingerprint,
  isArtifactReady,
  generateArtifact,
  lockOptions,
}) {
  assertNonEmptyString(markerPath, "Generated artifact marker path");
  assertNonEmptyString(fingerprint, "Generated artifact fingerprint");
  assertFunction(isArtifactReady, "Generated artifact readiness check");
  assertFunction(generateArtifact, "Generated artifact generator");

  return withDirectoryLock(
    lockPath,
    async () => {
      if ((await markerMatches(markerPath, fingerprint)) && (await isArtifactReady())) {
        return { generated: false };
      }

      await generateArtifact();
      if (!(await isArtifactReady())) {
        throw new Error("Shared generated artifact is not ready after generation.");
      }

      await mkdir(path.dirname(markerPath), { recursive: true });
      await writeFile(markerPath, `${fingerprint}\n`, "utf8");
      return { generated: true };
    },
    lockOptions,
  );
}
