import assert from "node:assert/strict";
import test from "node:test";

import { Controller, Get, Module } from "@nestjs/common";
import { DiscoveryModule } from "@nestjs/core";
import { Test } from "@nestjs/testing";

import { InternalApi, SupportedApi } from "./api-visibility.decorator.js";
import { inspectApiRoutes } from "./api-route-inspector.js";

@SupportedApi()
@Controller("supported")
class SupportedController {
  @Get("item")
  getItem(): { readonly ok: true } {
    return { ok: true };
  }
}

@InternalApi()
@Controller("internal")
class InternalController {
  @Get()
  list(): readonly string[] {
    return [];
  }
}

@Module({
  imports: [DiscoveryModule],
  controllers: [SupportedController, InternalController],
})
class ClassifiedRoutesModule {}

test("discovers normalized routes with resolved visibility", async () => {
  const module = await Test.createTestingModule({ imports: [ClassifiedRoutesModule] }).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix("api");
  await app.init();

  try {
    assert.deepEqual(
      inspectApiRoutes(app, "api").map(({ method, path, visibility }) => ({
        method,
        path,
        visibility,
      })),
      [
        { method: "GET", path: "/api/internal", visibility: "internal" },
        {
          method: "GET",
          path: "/api/supported/item",
          visibility: "public-supported",
        },
      ],
    );
  } finally {
    await app.close();
  }
});

@Controller("missing")
class MissingController {
  @Get()
  list(): readonly string[] {
    return [];
  }
}

@Module({ imports: [DiscoveryModule], controllers: [MissingController] })
class MissingRoutesModule {}

test("rejects an unclassified NestJS route", async () => {
  const module = await Test.createTestingModule({ imports: [MissingRoutesModule] }).compile();
  const app = module.createNestApplication();
  await app.init();

  try {
    assert.throws(
      () => inspectApiRoutes(app, "api"),
      /exactly one API visibility; no marker was found/,
    );
  } finally {
    await app.close();
  }
});
