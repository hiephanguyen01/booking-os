import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import YAML from "yaml";

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function requiredComposeVariable(name) {
  return `\${${name}:?${name} is required}`;
}

const [composeSource, dockerEnv, caddyfile, packageJson] = await Promise.all([
  readFile("compose.yaml", "utf8"),
  readFile(".env.docker.example", "utf8"),
  readFile("infra/caddy/Caddyfile", "utf8"),
  readJson("package.json"),
]);

const compose = YAML.parse(composeSource);

test("local HTTPS is opt-in and pins Caddy", () => {
  assert.match(dockerEnv, /^CADDY_VERSION=2\.11\.3$/m);
  assert.deepEqual(compose.services.caddy.profiles, ["https"]);
  assert.equal(compose.services.caddy.image, `caddy:${requiredComposeVariable("CADDY_VERSION")}`);
  assert.deepEqual(compose.services.caddy.ports, [
    `${requiredComposeVariable("CADDY_HTTP_PORT")}:80`,
    `${requiredComposeVariable("CADDY_HTTPS_PORT")}:443`,
  ]);
});

test("Caddy preserves the browser hostname and proxies only to the host console", () => {
  assert.deepEqual(compose.services.caddy.extra_hosts, ["host.docker.internal:host-gateway"]);
  assert.match(caddyfile, /platform\.booking\.localhost/);
  assert.match(caddyfile, /\*\.booking\.localhost/);
  assert.match(caddyfile, /tls internal/);
  assert.match(caddyfile, /reverse_proxy host\.docker\.internal:3002/);
  assert.doesNotMatch(caddyfile, /3001|5432|6379|9000|8025/);
});

test("repository scripts expose HTTPS lifecycle without changing normal infra:up", () => {
  assert.equal(
    packageJson.scripts["infra:up"],
    "docker compose --env-file .env.docker up -d --build",
  );
  assert.equal(
    packageJson.scripts["infra:https:config"],
    "docker compose --env-file .env.docker --profile https config --quiet",
  );
  assert.equal(
    packageJson.scripts["infra:https:up"],
    "docker compose --env-file .env.docker --profile https up -d caddy",
  );
  assert.equal(
    packageJson.scripts["infra:https:logs"],
    "docker compose --env-file .env.docker --profile https logs -f caddy",
  );
  assert.equal(
    packageJson.scripts["infra:https:down"],
    "docker compose --env-file .env.docker --profile https stop caddy",
  );
});

test("local HTTPS runbook documents the real secure browser workflow", async () => {
  const runbook = await readFile("docs/runbooks/local-https-development.md", "utf8");
  const readme = await readFile("README.md", "utf8");

  for (const required of [
    "https://platform.booking.localhost",
    "https://acme-studio.booking.localhost",
    "TRUST_PROXY=true",
    "TENANT_BASE_DOMAIN=booking.localhost",
    "PLATFORM_HOSTNAME=platform.booking.localhost",
    "SESSION_ALLOWED_ORIGINS=",
    "identity:bootstrap-platform-admin",
    "http://localhost:8025",
    "pnpm infra:https:up",
    "pnpm test:e2e",
  ]) {
    assert.ok(runbook.includes(required), `runbook must include ${required}`);
  }

  assert.ok(readme.includes("local-https-development.md"));
  assert.equal(readme.includes("no real login or cookie storage"), false);
});
