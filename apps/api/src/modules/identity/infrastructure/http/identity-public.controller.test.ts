import assert from "node:assert/strict";
import test from "node:test";

import {
  IdentityPublicController,
  type IdentityPublicControllerDependencies,
  type IdentityPublicHttpRequest,
  type IdentityPublicHttpResponse,
} from "./identity-public.controller.js";

type Purpose = "activation" | "password_forgot" | "password_reset";

class RecordingResponse implements IdentityPublicHttpResponse {
  statusCode = 200;
  readonly headers = new Map<string, string>();
  readonly cookies: Array<{ name: string; value: string; options: unknown }> = [];

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  cookie(name: string, value: string, options: unknown): void {
    this.cookies.push({ name, value, options });
  }
}

function request(overrides: Partial<IdentityPublicHttpRequest> = {}): IdentityPublicHttpRequest {
  return {
    hostname: "console.example.test",
    scope: { type: "platform" },
    expectedOrigin: "https://console.example.test",
    origin: "https://console.example.test",
    csrfCookie: "opaque-nonce",
    csrfToken: "opaque-proof",
    requestId: "request-1",
    ...overrides,
  };
}

function createDependencies(): {
  dependencies: IdentityPublicControllerDependencies;
  verifiedPurposes: Purpose[];
  commands: unknown[];
} {
  const verifiedPurposes: Purpose[] = [];
  const commands: unknown[] = [];
  return {
    verifiedPurposes,
    commands,
    dependencies: {
      csrf: {
        issue: () => ({
          token: "opaque-proof",
          expiresAt: new Date("2026-08-05T10:45:00.000Z"),
          cookie: {
            name: "__Host-booking_pre_auth_csrf",
            value: "opaque-nonce",
            options: {
              httpOnly: true,
              secure: true,
              sameSite: "strict",
              path: "/",
              maxAge: (15 * 60 * 1000) as 900_000,
            },
          },
        }),
        assertRequest: (_request, purpose) => {
          verifiedPurposes.push(purpose);
        },
      },
      completeActivation: {
        execute: async (command) => {
          commands.push(command);
          return { userId: "11111111-1111-4111-8111-111111111111" };
        },
      },
      requestPasswordReset: {
        execute: async (command) => {
          commands.push(command);
        },
      },
      completePasswordReset: {
        execute: async (command) => {
          commands.push(command);
          return { userId: "11111111-1111-4111-8111-111111111111" };
        },
      },
    },
  };
}

test("GET csrf sets a secure host-only cookie without exposing its nonce", () => {
  const { dependencies } = createDependencies();
  const controller = new IdentityPublicController(dependencies);
  const response = new RecordingResponse();

  const body = controller.getCsrf("activation", request(), response);

  assert.deepEqual(body, {
    csrfToken: "opaque-proof",
    expiresAt: "2026-08-05T10:45:00.000Z",
  });
  assert.equal(JSON.stringify(body).includes("opaque-nonce"), false);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.cookies[0]?.name, "__Host-booking_pre_auth_csrf");
  assert.deepEqual(response.cookies[0]?.options, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: "/",
    maxAge: 15 * 60 * 1000,
  });
});

test("password-forgot validates purpose and returns the same neutral response", async () => {
  const { dependencies, verifiedPurposes, commands } = createDependencies();
  const controller = new IdentityPublicController(dependencies);
  const response = new RecordingResponse();

  const body = await controller.requestPasswordReset(
    { email: "pilot@example.com" },
    request(),
    response,
  );

  assert.deepEqual(verifiedPurposes, ["password_forgot"]);
  assert.deepEqual(commands, [
    {
      email: "pilot@example.com",
      hostname: "console.example.test",
      scopeType: "platform",
      requestId: "request-1",
    },
  ]);
  assert.equal(response.statusCode, 202);
  assert.deepEqual(body, { accepted: true });
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("activation completes without creating a session or returning the user ID", async () => {
  const { dependencies, verifiedPurposes, commands } = createDependencies();
  const controller = new IdentityPublicController(dependencies);
  const response = new RecordingResponse();

  const body = await controller.completeActivation(
    {
      token: "selector.secret",
      newPassword: "correct horse battery staple",
    },
    request(),
    response,
  );

  assert.deepEqual(verifiedPurposes, ["activation"]);
  assert.deepEqual(commands, [
    {
      token: "selector.secret",
      newPassword: "correct horse battery staple",
      hostname: "console.example.test",
      scopeType: "platform",
      requestId: "request-1",
    },
  ]);
  assert.deepEqual(body, { completed: true });
  assert.equal(JSON.stringify(body).includes("11111111-1111-4111-8111-111111111111"), false);
  assert.equal(
    response.cookies.some((cookie) => /session/iu.test(cookie.name)),
    false,
  );
});

test("trusted tenant request scope overrides browser scope fields for every identity command", async () => {
  const { dependencies, commands } = createDependencies();
  const controller = new IdentityPublicController(dependencies);
  const tenantRequest = request({
    hostname: "studio.example.test",
    scope: { type: "tenant", tenantId: "11111111-1111-4111-8111-111111111111" },
  });
  const browserScopeClaim = { scopeType: "platform" as const };

  await controller.completeActivation(
    {
      token: "activation-selector.secret",
      newPassword: "correct horse battery staple",
      ...browserScopeClaim,
    },
    tenantRequest,
    new RecordingResponse(),
  );
  await controller.requestPasswordReset(
    { email: "pilot@example.com", ...browserScopeClaim },
    tenantRequest,
    new RecordingResponse(),
  );
  await controller.completePasswordReset(
    {
      token: "reset-selector.secret",
      newPassword: "correct horse battery staple",
      ...browserScopeClaim,
    },
    tenantRequest,
    new RecordingResponse(),
  );

  assert.deepEqual(commands, [
    {
      token: "activation-selector.secret",
      newPassword: "correct horse battery staple",
      hostname: "studio.example.test",
      scopeType: "tenant",
      tenantId: "11111111-1111-4111-8111-111111111111",
      requestId: "request-1",
    },
    {
      email: "pilot@example.com",
      hostname: "studio.example.test",
      scopeType: "tenant",
      tenantId: "11111111-1111-4111-8111-111111111111",
      requestId: "request-1",
    },
    {
      token: "reset-selector.secret",
      newPassword: "correct horse battery staple",
      hostname: "studio.example.test",
      scopeType: "tenant",
      tenantId: "11111111-1111-4111-8111-111111111111",
      requestId: "request-1",
    },
  ]);
});

test("CSRF rejection occurs before an identity use case is invoked", async () => {
  const { dependencies, commands } = createDependencies();
  dependencies.csrf.assertRequest = () => {
    throw new Error("identity.csrf.invalid");
  };
  const controller = new IdentityPublicController(dependencies);

  await assert.rejects(
    controller.completePasswordReset(
      {
        token: "selector.secret",
        newPassword: "correct horse battery staple",
      },
      request({ origin: "https://attacker.example.test" }),
      new RecordingResponse(),
    ),
    /identity\.csrf\.invalid/u,
  );
  assert.deepEqual(commands, []);
});
