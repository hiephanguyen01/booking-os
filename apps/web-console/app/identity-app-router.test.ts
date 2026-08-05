import assert from "node:assert/strict";
import test from "node:test";

interface IdentitySurface {
  readonly name: string;
  readonly pageModule: string;
  readonly routeModule: string;
}

const surfaces: readonly IdentitySurface[] = [
  {
    name: "account activation",
    pageModule: "./activate/page.js",
    routeModule: "./api/auth/activation/complete/route.js",
  },
  {
    name: "forgot password",
    pageModule: "./password/forgot/page.js",
    routeModule: "./api/auth/password/forgot/route.js",
  },
  {
    name: "reset password",
    pageModule: "./password/reset/page.js",
    routeModule: "./api/auth/password/reset/route.js",
  },
];

for (const surface of surfaces) {
  test(`${surface.name} exposes an App Router page and POST BFF route`, async () => {
    const page = await import(surface.pageModule);
    const route = await import(surface.routeModule);

    assert.equal(typeof page.default, "function");
    assert.equal(typeof route.POST, "function");
  });
}
