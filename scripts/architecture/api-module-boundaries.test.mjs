import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifyApiModuleBoundaries } from "./api-module-boundaries.mjs";

async function writeModule(repositoryRoot, moduleName, files) {
  const moduleRoot = path.join(repositoryRoot, "apps/api/src/modules", moduleName);
  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const filePath = path.join(moduleRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content, "utf8");
    }),
  );
  return { name: moduleName, root: `apps/api/src/modules/${moduleName}` };
}

async function withRepository(run) {
  const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "booking-os-architecture-"));
  try {
    await run(repositoryRoot);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
}

test("accepts a valid hexagonal module graph", async () => {
  await withRepository(async (repositoryRoot) => {
    const moduleDefinition = await writeModule(repositoryRoot, "catalog", {
      "domain/entity.ts": "export interface Entity { readonly id: string }",
      "application/ports/repository.port.ts":
        'import type { Entity } from "../../domain/entity.js"; export interface RepositoryPort { find(): Promise<Entity | null> }',
      "infrastructure/persistence/prisma.adapter.ts":
        'import type { RepositoryPort } from "../../application/ports/repository.port.js"; export class Adapter implements RepositoryPort { async find() { return null; } }',
      "catalog.module.ts":
        'import { Adapter } from "./infrastructure/persistence/prisma.adapter.js"; export const adapter = new Adapter();',
    });

    const failures = await verifyApiModuleBoundaries({
      repositoryRoot,
      modules: [moduleDefinition],
    });

    assert.deepEqual(failures, []);
  });
});

test("rejects forbidden dependencies and technology-specific ports", async () => {
  await withRepository(async (repositoryRoot) => {
    const catalog = await writeModule(repositoryRoot, "catalog", {
      "domain/nest.ts":
        'import { Injectable } from "@nestjs/common"; export const value = Injectable;',
      "domain/prisma.ts":
        'import type { Prisma } from "@prisma/client"; export type Value = Prisma.JsonValue;',
      "application/prisma.ts":
        'import { PrismaClient } from "@prisma/client"; export const prisma = new PrismaClient();',
      "application/infra.ts":
        'import { Adapter } from "../infrastructure/adapter.js"; export const adapter = new Adapter();',
      "application/ports/unit-of-work.port.ts":
        'import type { Prisma } from "@prisma/client"; export interface UnitOfWork { run(tx: Prisma.TransactionClient): Promise<void> }',
      "application/cross-module.ts":
        'import { Repository } from "../../booking/infrastructure/repository.js"; export const repository = new Repository();',
      "infrastructure/adapter.ts": "export class Adapter {}",
    });
    const booking = await writeModule(repositoryRoot, "booking", {
      "infrastructure/repository.ts": "export class Repository {}",
    });

    const failures = await verifyApiModuleBoundaries({
      repositoryRoot,
      modules: [catalog, booking],
    });

    assert.ok(
      failures.some(
        (failure) => failure.includes("domain/nest.ts") && failure.includes("@nestjs/common"),
      ),
    );
    assert.ok(
      failures.some(
        (failure) => failure.includes("domain/prisma.ts") && failure.includes("@prisma/client"),
      ),
    );
    assert.ok(
      failures.some(
        (failure) =>
          failure.includes("application/prisma.ts") && failure.includes("@prisma/client"),
      ),
    );
    assert.ok(
      failures.some(
        (failure) => failure.includes("application/infra.ts") && failure.includes("infrastructure"),
      ),
    );
    assert.ok(
      failures.some(
        (failure) =>
          failure.includes("unit-of-work.port.ts") && failure.includes("TransactionClient"),
      ),
    );
    assert.ok(
      failures.some(
        (failure) =>
          failure.includes("catalog/application/cross-module.ts") &&
          failure.includes("cross-module infrastructure"),
      ),
    );
    assert.deepEqual(failures, [...failures].sort());
  });
});

test("fails closed when a module directory is not registered", async () => {
  await withRepository(async (repositoryRoot) => {
    await writeModule(repositoryRoot, "unregistered", {
      "domain/entity.ts": "export interface Entity { readonly id: string }",
    });

    const failures = await verifyApiModuleBoundaries({ repositoryRoot, modules: [] });

    assert.deepEqual(failures, [
      "apps/api/src/modules/unregistered: module directory is not registered in api-module-manifest.mjs",
    ]);
  });
});
