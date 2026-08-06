import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { withDirectoryLock } from "./shared-client-lock.mjs";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const lockPath = path.join(repositoryRoot, ".turbo", "prisma-client-generate.lock");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

function generatePrismaClient() {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pnpmCommand,
      ["--filter", "@booking-os/api", "exec", "prisma", "generate"],
      {
        cwd: repositoryRoot,
        env: process.env,
        stdio: "inherit",
      },
    );

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `Shared Prisma client generation was terminated by ${signal}.`
            : `Shared Prisma client generation exited with code ${String(code)}.`,
        ),
      );
    });
  });
}

await withDirectoryLock(lockPath, generatePrismaClient);
