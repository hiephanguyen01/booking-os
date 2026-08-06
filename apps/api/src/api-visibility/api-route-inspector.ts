import "reflect-metadata";

import { type INestApplication, RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants.js";
import { DiscoveryService } from "@nestjs/core";

import type { ApiVisibility } from "./api-visibility.decorator.js";
import { resolveApiVisibility } from "./api-visibility.resolver.js";

export interface ApiRoute {
  readonly controller: string;
  readonly handler: string;
  readonly method: string;
  readonly path: string;
  readonly visibility: ApiVisibility;
}

type ControllerType = abstract new (...args: never[]) => unknown;
type Handler = (...args: never[]) => unknown;

function metadataPaths(target: object): readonly string[] {
  const metadata = Reflect.getMetadata(PATH_METADATA, target) as
    | string
    | readonly string[]
    | undefined;
  if (metadata === undefined) {
    return [""];
  }
  return typeof metadata === "string" ? [metadata] : metadata;
}

function methodNames(prototype: object): readonly string[] {
  const names = new Set<string>();
  let current: object | null = prototype;
  while (current !== null && current !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name !== "constructor") {
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (typeof descriptor?.value === "function") {
          names.add(name);
        }
      }
    }
    current = Object.getPrototypeOf(current) as object | null;
  }
  return [...names].sort();
}

function normalizePathSegment(segment: string): string {
  const parameter = /^:([A-Za-z0-9_]+)$/.exec(segment);
  return parameter === null ? segment : `{${parameter[1]}}`;
}

function joinPath(...parts: readonly string[]): string {
  const segments = parts
    .flatMap((part) => part.split("/"))
    .map((part) => part.trim())
    .filter(Boolean)
    .map(normalizePathSegment);
  return `/${segments.join("/")}`;
}

export function inspectApiRoutes(app: INestApplication, globalPrefix: string): readonly ApiRoute[] {
  const discovery = app.get(DiscoveryService);
  const routes: ApiRoute[] = [];

  for (const wrapper of discovery.getControllers()) {
    const controller = wrapper.metatype as ControllerType | undefined;
    const instance = wrapper.instance as object | undefined;
    if (controller === undefined || instance === undefined) {
      continue;
    }

    const prototype = Object.getPrototypeOf(instance) as Record<string, Handler | undefined>;
    for (const handlerName of methodNames(prototype)) {
      const handler = prototype[handlerName];
      if (handler === undefined) {
        continue;
      }
      const requestMethod = Reflect.getMetadata(METHOD_METADATA, handler) as
        | RequestMethod
        | undefined;
      if (requestMethod === undefined) {
        continue;
      }

      const visibility = resolveApiVisibility(controller, handler);
      const method = String(RequestMethod[requestMethod]).toUpperCase();
      for (const controllerPath of metadataPaths(controller)) {
        for (const handlerPath of metadataPaths(handler)) {
          routes.push({
            controller: controller.name,
            handler: handlerName,
            method,
            path: joinPath(globalPrefix, controllerPath, handlerPath),
            visibility,
          });
        }
      }
    }
  }

  const sorted = routes.sort(
    (left, right) => left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
  );
  const seen = new Set<string>();
  for (const route of sorted) {
    const key = `${route.method} ${route.path}`;
    if (seen.has(key)) {
      throw new Error(`duplicate NestJS route discovered: ${key}`);
    }
    seen.add(key);
  }
  return sorted;
}
