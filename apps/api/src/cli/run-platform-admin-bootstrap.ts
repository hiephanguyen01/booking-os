import "dotenv/config";

import { PrismaClient } from "@prisma/client";

import { parseEnvironment } from "../config/environment.js";
import { executePlatformAdminBootstrap } from "./execute-platform-admin-bootstrap.js";

function readHostname(arguments_: readonly string[]): string {
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];

    if (argument?.startsWith("--hostname=")) {
      const hostname = argument.slice("--hostname=".length).trim();
      if (hostname.length > 0) {
        return hostname;
      }
    }

    if (argument === "--hostname") {
      const hostname = arguments_[index + 1]?.trim();
      if (hostname) {
        return hostname;
      }
    }
  }

  throw new Error("Platform bootstrap requires --hostname <platform-hostname>.");
}

async function main(): Promise<void> {
  const environment = parseEnvironment(process.env);

  if (!environment.identitySecurity.bootstrapEnabled) {
    throw new Error("Platform bootstrap is disabled by configuration.");
  }

  const email = environment.identitySecurity.bootstrapAdminEmail;
  if (!email) {
    throw new Error("Platform bootstrap administrator email is unavailable.");
  }

  const prisma = new PrismaClient({
    datasources: { db: { url: environment.databaseUrl } },
  });

  try {
    const result = await executePlatformAdminBootstrap({
      prisma,
      email,
      hostname: readHostname(process.argv.slice(2)),
      security: environment.identitySecurity,
    });

    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Platform bootstrap failed.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
