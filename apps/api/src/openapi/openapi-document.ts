import type { INestApplication } from "@nestjs/common";
import {
  DocumentBuilder,
  type OpenAPIObject,
  SwaggerModule,
} from "@nestjs/swagger";

import { inspectApiRoutes } from "../api-visibility/api-route-inspector.js";

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const HTTP_METHOD_SET = new Set<string>(HTTP_METHODS);

function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (!isRecord(value)) {
    return value;
  }

  const entries = Object.entries(value)
    .filter(([key]) => key !== "servers" && !key.startsWith("x-generated-"))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, normalizeValue(child)] as const);
  return Object.fromEntries(entries);
}

export function normalizeOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
  const normalized = normalizeValue(document) as OpenAPIObject;
  if (Array.isArray(normalized.tags)) {
    normalized.tags = [...normalized.tags].sort((left, right) => left.name.localeCompare(right.name));
  }
  return normalized;
}

function collectOperations(document: OpenAPIObject): ReadonlyMap<string, Record<string, unknown>> {
  const operations = new Map<string, Record<string, unknown>>();
  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (isRecord(operation)) {
        operations.set(routeKey(method, path), operation);
      }
    }
  }
  return operations;
}

function validateSupportedOperations(document: OpenAPIObject, supportedKeys: ReadonlySet<string>): void {
  const operationIds = new Map<string, string>();
  const operations = collectOperations(document);

  for (const key of supportedKeys) {
    const operation = operations.get(key);
    if (operation === undefined) {
      throw new Error(`supported route is missing from OpenAPI output: ${key}`);
    }

    const operationId = operation.operationId;
    if (typeof operationId !== "string" || operationId.trim() === "") {
      throw new Error(`supported route is missing operationId: ${key}`);
    }
    const previous = operationIds.get(operationId);
    if (previous !== undefined) {
      throw new Error(`duplicate OpenAPI operationId ${operationId}: ${previous} and ${key}`);
    }
    operationIds.set(operationId, key);

    const tags = operation.tags;
    if (!Array.isArray(tags) || tags.length === 0 || tags.some((tag) => typeof tag !== "string")) {
      throw new Error(`supported route is missing a domain tag: ${key}`);
    }

    const responses = operation.responses;
    if (
      !isRecord(responses) ||
      !Object.keys(responses).some((status) => /^2\d\d$/.test(status))
    ) {
      throw new Error(`supported route is missing an explicit 2xx response: ${key}`);
    }
  }
}

export function filterSupportedOpenApiDocument(
  document: OpenAPIObject,
  supportedKeys: ReadonlySet<string>,
  classifiedKeys: ReadonlySet<string>,
): OpenAPIObject {
  const filteredPaths: Record<string, unknown> = {};

  for (const [path, pathItem] of Object.entries(document.paths)) {
    if (!isRecord(pathItem)) {
      continue;
    }

    const filteredPathItem: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(pathItem)) {
      if (!HTTP_METHOD_SET.has(key)) {
        if (key !== "servers") {
          filteredPathItem[key] = value;
        }
        continue;
      }

      const classifiedKey = routeKey(key, path);
      if (!classifiedKeys.has(classifiedKey)) {
        throw new Error(`Swagger operation has no classified NestJS route: ${classifiedKey}`);
      }
      if (supportedKeys.has(classifiedKey)) {
        filteredPathItem[key] = value;
      }
    }

    if (Object.keys(filteredPathItem).some((key) => HTTP_METHOD_SET.has(key))) {
      filteredPaths[path] = filteredPathItem;
    }
  }

  const filtered = {
    ...document,
    paths: filteredPaths,
  } as OpenAPIObject;
  validateSupportedOperations(filtered, supportedKeys);
  return filtered;
}

export function createSupportedOpenApiDocument(
  app: INestApplication,
  globalPrefix: string,
): OpenAPIObject {
  const routes = inspectApiRoutes(app, globalPrefix);
  const classifiedKeys = new Set(routes.map((route) => routeKey(route.method, route.path)));
  const supportedKeys = new Set(
    routes
      .filter((route) => route.visibility === "public-supported")
      .map((route) => routeKey(route.method, route.path)),
  );

  const configuration = new DocumentBuilder()
    .setTitle("Booking OS API")
    .setDescription("Supported Booking OS HTTP API")
    .setVersion("0.1.0")
    .build();
  const fullDocument = SwaggerModule.createDocument(app, configuration);
  const filtered = filterSupportedOpenApiDocument(fullDocument, supportedKeys, classifiedKeys);
  return normalizeOpenApiDocument(filtered);
}

export function serializeOpenApiDocument(document: OpenAPIObject): string {
  return `${JSON.stringify(normalizeOpenApiDocument(document), null, 2)}\n`;
}
