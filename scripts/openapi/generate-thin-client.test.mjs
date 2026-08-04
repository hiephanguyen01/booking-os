import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const generatorPath = join(repositoryRoot, "scripts/openapi/generate-thin-client.mjs");
const fixturePath = join(repositoryRoot, "scripts/openapi/fixtures/generator-contract.json");

function runGenerator(inputPath, outputPath) {
  return spawnSync(process.execPath, [generatorPath, inputPath, outputPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
}

test("emits typed path, query, header, JSON body, and response mappings", async () => {
  const directory = await mkdtemp(join(tmpdir(), "booking-os-client-generator-"));
  const outputPath = join(directory, "client.ts");

  try {
    const result = runGenerator(fixturePath, outputPath);
    assert.equal(result.status, 0, `generator failed:\n${result.stdout}\n${result.stderr}`);

    const source = await readFile(outputPath, "utf8");
    assert.match(source, /AUTO-GENERATED\. DO NOT EDIT\. Run pnpm api:generate\./);
    assert.match(source, /import type \{ operations \} from "\.\/schema\.js";/);
    assert.match(source, /updateWidget\(/);
    assert.match(source, /encodeURIComponent\(String\(parameters\.path\.widgetId\)\)/);
    assert.match(source, /query: parameters\.query/);
    assert.match(source, /headers: parameters\.headers/);
    assert.match(source, /body: parameters\.body/);
    assert.match(
      source,
      /operations\["updateWidget"\]\["responses"\]\[200\]\["content"\]\["application\/json"\]/,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects duplicate operation IDs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "booking-os-client-generator-"));
  const inputPath = join(directory, "duplicate.json");
  const outputPath = join(directory, "client.ts");

  try {
    const document = JSON.parse(await readFile(fixturePath, "utf8"));
    document.paths["/widgets/duplicate"] = {
      post: {
        ...document.paths["/widgets/{widgetId}"].post,
        parameters: [],
      },
    };
    await writeFile(inputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    const result = runGenerator(inputPath, outputPath);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /duplicate operationId: updateWidget/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects multipart request bodies instead of emitting a misleading client", async () => {
  const directory = await mkdtemp(join(tmpdir(), "booking-os-client-generator-"));
  const inputPath = join(directory, "multipart.json");
  const outputPath = join(directory, "client.ts");

  try {
    const document = JSON.parse(await readFile(fixturePath, "utf8"));
    const operation = document.paths["/widgets/{widgetId}"].post;
    operation.requestBody.content = {
      "multipart/form-data": {
        schema: { type: "object" },
      },
    };
    await writeFile(inputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");

    const result = runGenerator(inputPath, outputPath);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /unsupported request body media type for updateWidget/);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
