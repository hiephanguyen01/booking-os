import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ensureGeneratedArtifact } from "./shared-client-lock.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const lockPath = path.join(repositoryRoot, ".turbo", "prisma-client-generate.lock");
const markerPath = path.join(repositoryRoot, ".turbo", "prisma-client-generate.ready");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const generationProtocol = "booking-os-shared-prisma-client-v2";
const fingerprintInputPaths = [
  "apps/api/prisma/schema.prisma",
  "apps/api/package.json",
  "pnpm-lock.yaml",
];
const readinessProbe = `
(async () => {
  const { PrismaClient } = require("@prisma/client");
  if (typeof PrismaClient !== "function") process.exit(1);
  const client = new PrismaClient();
  await client.$disconnect();
})().catch(() => process.exit(1));
`;

function runPnpm(args, { stdio = "inherit", failureLabel }) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, args, {
      cwd: repositoryRoot,
      env: process.env,
      stdio,
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `${failureLabel} was terminated by ${signal}.`
            : `${failureLabel} exited with code ${String(code)}.`,
        ),
      );
    });
  });
}

async function createGenerationFingerprint() {
  const hash = createHash("sha256");
  hash.update(generationProtocol);
  hash.update("\0");
  hash.update(process.platform);
  hash.update("\0");
  hash.update(process.arch);

  for (const relativePath of fingerprintInputPaths) {
    hash.update("\0");
    hash.update(relativePath);
    hash.update("\0");
    hash.update(await readFile(path.join(repositoryRoot, relativePath)));
  }

  return hash.digest("hex");
}

async function isPrismaClientReady() {
  try {
    await runPnpm(["--filter", "@booking-os/api", "exec", "node", "--eval", readinessProbe], {
      stdio: "ignore",
      failureLabel: "Shared Prisma client readiness probe",
    });
    return true;
  } catch {
    return false;
  }
}

function generatePrismaClient() {
  return runPnpm(["--filter", "@booking-os/api", "exec", "prisma", "generate"], {
    failureLabel: "Shared Prisma client generation",
  });
}

const fingerprint = await createGenerationFingerprint();
const result = await ensureGeneratedArtifact({
  lockPath,
  markerPath,
  fingerprint,
  isArtifactReady: isPrismaClientReady,
  generateArtifact: generatePrismaClient,
});

if (!result.generated) {
  console.log("Reusing the ready shared Prisma client.");
}
