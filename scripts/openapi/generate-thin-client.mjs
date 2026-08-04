import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const PATH_PARAMETER = /\{([^}]+)\}/g;

class GeneratorError extends Error {}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertRecord(value, message) {
  if (!isRecord(value)) {
    throw new GeneratorError(message);
  }
  return value;
}

function typeIndex(operationId) {
  return `operations[${JSON.stringify(operationId)}]`;
}

function propertyAccess(base, name) {
  return IDENTIFIER.test(name) ? `${base}.${name}` : `${base}[${JSON.stringify(name)}]`;
}

function parameterStyle(location, parameter) {
  const defaults = {
    header: { explode: false, style: "simple" },
    path: { explode: false, style: "simple" },
    query: { explode: true, style: "form" },
  };
  const expected = defaults[location];
  const style = parameter.style ?? expected.style;
  const explode = parameter.explode ?? expected.explode;
  if (style !== expected.style || explode !== expected.explode) {
    throw new GeneratorError(
      `unsupported ${location} parameter serialization for ${parameter.name}`,
    );
  }
}

function collectParameters(pathItem, operation, operationId) {
  const all = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])];
  const groups = new Map([
    ["path", []],
    ["query", []],
    ["header", []],
  ]);
  const seen = new Set();

  for (const rawParameter of all) {
    const parameter = assertRecord(
      rawParameter,
      `invalid parameter declaration for ${operationId}`,
    );
    if ("$ref" in parameter) {
      throw new GeneratorError(`parameter references are unsupported for ${operationId}`);
    }
    const location = parameter.in;
    const name = parameter.name;
    if (!groups.has(location) || typeof name !== "string" || name.length === 0) {
      throw new GeneratorError(`unsupported parameter declaration for ${operationId}`);
    }
    const key = `${location}:${name}`;
    if (seen.has(key)) {
      throw new GeneratorError(`duplicate parameter ${key} for ${operationId}`);
    }
    seen.add(key);
    if (location === "path" && parameter.required !== true) {
      throw new GeneratorError(`path parameter ${name} must be required for ${operationId}`);
    }
    parameterStyle(location, parameter);
    groups.get(location).push({
      name,
      required: parameter.required === true,
    });
  }

  for (const parameters of groups.values()) {
    parameters.sort((left, right) => left.name.localeCompare(right.name));
  }
  return groups;
}

function requestBody(operation, operationId) {
  if (operation.requestBody === undefined) {
    return undefined;
  }
  const body = assertRecord(operation.requestBody, `invalid request body for ${operationId}`);
  if ("$ref" in body) {
    throw new GeneratorError(`request body references are unsupported for ${operationId}`);
  }
  const content = assertRecord(body.content, `request body content is required for ${operationId}`);
  const mediaTypes = Object.keys(content).sort();
  if (mediaTypes.length !== 1 || mediaTypes[0] !== "application/json") {
    throw new GeneratorError(`unsupported request body media type for ${operationId}`);
  }
  return { required: body.required === true };
}

function responseType(operation, operationId) {
  const responses = assertRecord(operation.responses, `responses are required for ${operationId}`);
  const status = Object.keys(responses)
    .filter((value) => /^2\d\d$/.test(value))
    .sort((left, right) => Number(left) - Number(right))[0];
  if (status === undefined) {
    throw new GeneratorError(`a 2xx response is required for ${operationId}`);
  }
  const response = assertRecord(responses[status], `invalid ${status} response for ${operationId}`);
  if ("$ref" in response) {
    throw new GeneratorError(`response references are unsupported for ${operationId}`);
  }
  if (response.content === undefined) {
    return "void";
  }
  const content = assertRecord(response.content, `invalid ${status} response content for ${operationId}`);
  const mediaTypes = Object.keys(content).sort();
  if (mediaTypes.length !== 1 || mediaTypes[0] !== "application/json") {
    throw new GeneratorError(`unsupported response media type for ${operationId}`);
  }
  return `${typeIndex(operationId)}["responses"][${Number(status)}]["content"]["application/json"]`;
}

function renderPath(path, pathParameters, operationId) {
  if (path.includes("`") || path.includes("${")) {
    throw new GeneratorError(`unsupported path syntax for ${operationId}`);
  }
  const declared = new Set(pathParameters.map((parameter) => parameter.name));
  const used = new Set();
  const expression = path.replaceAll(PATH_PARAMETER, (_match, name) => {
    if (!declared.has(name)) {
      throw new GeneratorError(`missing path parameter ${name} for ${operationId}`);
    }
    used.add(name);
    const access = propertyAccess("parameters.path", name);
    return `\${encodeURIComponent(String(${access}))}`;
  });
  for (const name of declared) {
    if (!used.has(name)) {
      throw new GeneratorError(`unused path parameter ${name} for ${operationId}`);
    }
  }
  return pathParameters.length === 0 ? JSON.stringify(path) : `\`${expression}\``;
}

function interfaceName(operationId) {
  const name = `${operationId[0].toUpperCase()}${operationId.slice(1)}Parameters`;
  if (!IDENTIFIER.test(name)) {
    throw new GeneratorError(`operationId is not a supported TypeScript identifier: ${operationId}`);
  }
  return name;
}

function collectOperations(document) {
  if (typeof document.openapi !== "string" || !document.openapi.startsWith("3.")) {
    throw new GeneratorError("input must be an OpenAPI 3.x document");
  }
  const paths = assertRecord(document.paths, "OpenAPI paths must be an object");
  const operations = [];
  const operationIds = new Set();
  const interfaceNames = new Set();

  for (const path of Object.keys(paths).sort()) {
    const pathItem = assertRecord(paths[path], `invalid path item: ${path}`);
    for (const method of HTTP_METHODS) {
      if (pathItem[method] === undefined) {
        continue;
      }
      const operation = assertRecord(pathItem[method], `invalid ${method.toUpperCase()} ${path}`);
      const operationId = operation.operationId;
      if (typeof operationId !== "string" || !IDENTIFIER.test(operationId)) {
        throw new GeneratorError(`invalid operationId for ${method.toUpperCase()} ${path}`);
      }
      if (operationIds.has(operationId)) {
        throw new GeneratorError(`duplicate operationId: ${operationId}`);
      }
      operationIds.add(operationId);
      if (operation.callbacks !== undefined) {
        throw new GeneratorError(`callbacks are unsupported for ${operationId}`);
      }

      const parameters = collectParameters(pathItem, operation, operationId);
      const body = requestBody(operation, operationId);
      const hasParameters = [...parameters.values()].some((group) => group.length > 0) || body;
      const parametersInterface = hasParameters ? interfaceName(operationId) : undefined;
      if (parametersInterface !== undefined && interfaceNames.has(parametersInterface)) {
        throw new GeneratorError(`generated parameter interface collision: ${parametersInterface}`);
      }
      if (parametersInterface !== undefined) {
        interfaceNames.add(parametersInterface);
      }

      operations.push({
        body,
        method: method.toUpperCase(),
        operationId,
        parameters,
        parametersInterface,
        pathExpression: renderPath(path, parameters.get("path"), operationId),
        responseType: responseType(operation, operationId),
      });
    }
  }
  return operations;
}

function renderParameterInterfaces(operations) {
  const blocks = [];
  for (const operation of operations) {
    if (operation.parametersInterface === undefined) {
      continue;
    }
    const index = typeIndex(operation.operationId);
    const lines = [`export interface ${operation.parametersInterface} {`];
    for (const [location, property] of [
      ["path", "path"],
      ["query", "query"],
      ["header", "headers"],
    ]) {
      const group = operation.parameters.get(location);
      if (group.length === 0) {
        continue;
      }
      const optional = group.some((parameter) => parameter.required) ? "" : "?";
      lines.push(
        `  readonly ${property}${optional}: ${index}["parameters"][${JSON.stringify(location)}];`,
      );
    }
    if (operation.body !== undefined) {
      const optional = operation.body.required ? "" : "?";
      lines.push(
        `  readonly body${optional}: ${index}["requestBody"]["content"]["application/json"];`,
      );
    }
    lines.push("}");
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

function methodSignature(operation) {
  const parameters = operation.parametersInterface
    ? `parameters: ${operation.parametersInterface}, options?: GeneratedRequestOptions`
    : "options?: GeneratedRequestOptions";
  return `  readonly ${operation.operationId}: (${parameters}) => Promise<${operation.responseType}>;`;
}

function methodImplementation(operation) {
  const argumentsList = operation.parametersInterface
    ? "parameters, options"
    : "options";
  const requestLines = [
    `      method: ${JSON.stringify(operation.method)},`,
    `      path: ${operation.pathExpression},`,
  ];
  if (operation.parameters.get("query").length > 0) {
    requestLines.push("      query: parameters.query,");
  }
  if (operation.parameters.get("header").length > 0) {
    requestLines.push("      headers: parameters.headers,");
  }
  if (operation.body !== undefined) {
    requestLines.push("      body: parameters.body,");
  }
  return [
    `    async ${operation.operationId}(${argumentsList}) {`,
    `      return transport<${operation.responseType}>({`,
    ...requestLines,
    "      }, options);",
    "    },",
  ].join("\n");
}

function renderClient(document) {
  const operations = collectOperations(document);
  const parameterInterfaces = renderParameterInterfaces(operations);
  const sections = [
    "// AUTO-GENERATED. DO NOT EDIT. Run pnpm api:generate.",
    'import type { operations } from "./schema.js";',
    "",
    "export interface GeneratedRequest {",
    "  readonly method: string;",
    "  readonly path: string;",
    "  readonly query?: Readonly<Record<string, unknown>>;",
    "  readonly headers?: Readonly<Record<string, string>>;",
    "  readonly body?: unknown;",
    "}",
    "",
    "export interface GeneratedRequestOptions {",
    "  readonly signal?: AbortSignal;",
    "}",
    "",
    "export type GeneratedTransport = <TResponse>(",
    "  request: GeneratedRequest,",
    "  options?: GeneratedRequestOptions,",
    ") => Promise<TResponse>;",
  ];
  if (parameterInterfaces.length > 0) {
    sections.push("", parameterInterfaces);
  }
  sections.push(
    "",
    "export interface GeneratedClient {",
    ...operations.map(methodSignature),
    "}",
    "",
    "export function createGeneratedClient(transport: GeneratedTransport): GeneratedClient {",
    "  return {",
    ...operations.map(methodImplementation),
    "  };",
    "}",
    "",
  );
  return sections.join("\n");
}

async function atomicWrite(outputPath, content) {
  await mkdir(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, outputPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function main() {
  const [, , inputArgument, outputArgument] = process.argv;
  if (inputArgument === undefined || outputArgument === undefined || process.argv.length !== 4) {
    throw new GeneratorError("usage: generate-thin-client.mjs INPUT_OPENAPI OUTPUT_TYPESCRIPT");
  }
  const inputPath = resolve(inputArgument);
  const outputPath = resolve(outputArgument);
  const document = JSON.parse(await readFile(inputPath, "utf8"));
  await atomicWrite(outputPath, renderClient(document));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "unknown thin-client generation failure";
  process.stderr.write(`Thin-client generation failed: ${message}\n`);
  process.exitCode = 1;
});
