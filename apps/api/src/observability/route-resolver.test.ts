import assert from "node:assert/strict";
import test from "node:test";

import {
  isSuccessfulHealthRoute,
  type RoutableRequest,
  resolveRequestRoute,
} from "./route-resolver.js";

test("resolves the mounted route template", () => {
  const request = {
    baseUrl: "/api",
    route: { path: "/bookings/:id" },
  } as RoutableRequest;

  assert.equal(resolveRequestRoute(request), "/api/bookings/:id");
});

test("keeps an absolute route template without duplicating the prefix", () => {
  const request = {
    baseUrl: "",
    route: { path: "/api/health" },
  } as RoutableRequest;

  assert.equal(resolveRequestRoute(request), "/api/health");
});

test("falls back to a pathname without query values", () => {
  const request = {
    originalUrl: "/api/search?q=secret",
  } as RoutableRequest;

  assert.equal(resolveRequestRoute(request), "/api/search");
});

test("normalizes duplicate slashes and always returns a leading slash", () => {
  const request = {
    baseUrl: "api/",
    route: { path: "//bookings/:id" },
  } as RoutableRequest;

  assert.equal(resolveRequestRoute(request), "/api/bookings/:id");
});

test("suppresses only successful health and readiness routes", () => {
  assert.equal(isSuccessfulHealthRoute("/api/health", 200, "api"), true);
  assert.equal(isSuccessfulHealthRoute("/api/ready", 200, "api"), true);
  assert.equal(isSuccessfulHealthRoute("/api/ready", 503, "api"), false);
  assert.equal(isSuccessfulHealthRoute("/api/health-check", 200, "api"), false);
});
