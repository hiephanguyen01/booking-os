import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

async function reservePort(): Promise<{
  readonly close: () => Promise<void>;
  readonly port: number;
}> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    port: address.port,
  };
}

interface OpenApiOperation {
  readonly operationId?: string;
  readonly parameters?: readonly {
    readonly in?: string;
    readonly name?: string;
    readonly required?: boolean;
    readonly schema?: { readonly format?: string; readonly type?: string };
  }[];
  readonly requestBody?: {
    readonly content?: {
      readonly "application/json"?: {
        readonly schema?: { readonly $ref?: string };
      };
    };
  };
  readonly responses?: Readonly<
    Record<
      string,
      {
        readonly content?: {
          readonly "application/json"?: {
            readonly schema?: { readonly $ref?: string };
          };
        };
      }
    >
  >;
}

test("generates the contract without binding a port or reaching infrastructure", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "booking-os-openapi-"));
  const outputPath = join(temporaryDirectory, "openapi.json");
  const apiRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
  const reservedPort = await reservePort();

  try {
    const result = spawnSync("pnpm", ["openapi:generate"], {
      cwd: apiRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        API_PREFIX: "api",
        DATABASE_URL: "postgresql://booking:booking@127.0.0.1:1/booking_os_openapi",
        NODE_ENV: "test",
        OPENAPI_OUTPUT_PATH: outputPath,
        PAYMENT_PROVIDER: "mock",
        PORT: String(reservedPort.port),
        REDIS_URL: "redis://127.0.0.1:1/15",
        SESSION_SECRET: "openapi-generation-only-secret-at-least-32-characters",
      },
      timeout: 30_000,
    });

    assert.equal(result.status, 0, `generator failed:\n${result.stdout}\n${result.stderr}`);
    const source = await readFile(outputPath, "utf8");
    const document = JSON.parse(source) as {
      readonly paths: Readonly<Record<string, Readonly<Record<string, OpenApiOperation>>>>;
    };
    assert.deepEqual(Object.keys(document.paths), [
      "/api/auth/activation/complete",
      "/api/auth/csrf",
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/me",
      "/api/auth/password/forgot",
      "/api/auth/password/reset",
      "/api/auth/session/csrf",
      "/api/auth/session/refresh",
      "/api/auth/sessions",
      "/api/auth/sessions/{sessionId}",
      "/api/auth/sessions/revoke-others",
      "/api/health",
      "/api/membership/invitations",
      "/api/membership/invitations/{invitationId}/resend",
      "/api/membership/invitations/accept",
      "/api/membership/invitations/current",
      "/api/platform/tenants",
      "/api/platform/tenants/{tenantId}",
      "/api/platform/tenants/{tenantId}/owner-invitation/resend",
      "/api/ready",
    ]);
    assert.deepEqual(
      Object.values(document.paths)
        .flatMap((pathItem) => Object.values(pathItem))
        .map((operation) => operation.operationId)
        .filter((operationId): operationId is string => operationId !== undefined)
        .sort(),
      [
        "acceptMembershipInvitation",
        "completeAccountActivation",
        "completePasswordReset",
        "createTenantAdminInvitation",
        "getCurrentMembershipInvitation",
        "getCurrentSession",
        "getHealth",
        "getPlatformTenantProvisioning",
        "getPreAuthCsrf",
        "getReadiness",
        "getSessionCsrf",
        "listSessions",
        "loginSession",
        "logoutSession",
        "provisionPlatformTenant",
        "refreshSession",
        "requestPasswordReset",
        "resendPlatformTenantOwnerInvitation",
        "resendTenantAdminInvitation",
        "revokeOtherSessions",
        "revokeSession",
      ],
    );

    const login = document.paths["/api/auth/login"]?.post;
    assert.equal(
      login?.requestBody?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/LoginRequestDto",
    );
    assert.equal(
      login?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/SessionResponseDto",
    );

    const sessionCsrf = document.paths["/api/auth/session/csrf"]?.get;
    assert.equal(
      sessionCsrf?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/SessionCsrfResponseDto",
    );

    const refresh = document.paths["/api/auth/session/refresh"]?.post;
    assert.equal(
      refresh?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/SessionResponseDto",
    );

    const revoke = document.paths["/api/auth/sessions/{sessionId}"]?.delete;
    assert.deepEqual(revoke?.parameters, [
      {
        in: "path",
        name: "sessionId",
        required: true,
        schema: { format: "uuid", type: "string" },
      },
    ]);
    assert.equal(
      revoke?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/RevokeDeviceResponseDto",
    );

    const createAdminInvitation = document.paths["/api/membership/invitations"]?.post;
    assert.equal(
      createAdminInvitation?.responses?.["202"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/TenantInvitationAcceptedResponseDto",
    );

    const acceptInvitation = document.paths["/api/membership/invitations/accept"]?.post;
    assert.equal(
      acceptInvitation?.requestBody?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/AcceptTenantInvitationRequestDto",
    );
    assert.equal(
      acceptInvitation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/TenantInvitationAcceptedResponseDto",
    );

    const currentInvitation = document.paths["/api/membership/invitations/current"]?.get;
    assert.equal(
      currentInvitation?.responses?.["200"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/CurrentTenantInvitationResponseDto",
    );

    const resendAdminInvitation =
      document.paths["/api/membership/invitations/{invitationId}/resend"]?.post;
    assert.equal(
      resendAdminInvitation?.responses?.["202"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/TenantInvitationAcceptedResponseDto",
    );

    const resendOwnerInvitation =
      document.paths["/api/platform/tenants/{tenantId}/owner-invitation/resend"]?.post;
    assert.equal(
      resendOwnerInvitation?.responses?.["202"]?.content?.["application/json"]?.schema?.$ref,
      "#/components/schemas/OwnerInvitationResendResponseDto",
    );
  } finally {
    await reservedPort.close();
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
});
