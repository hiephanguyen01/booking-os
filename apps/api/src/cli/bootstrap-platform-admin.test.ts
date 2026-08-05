import assert from "node:assert/strict";
import test from "node:test";

import {
  PlatformAdminAlreadyBootstrappedError,
  bootstrapPlatformAdmin,
  type PlatformAdminBootstrapStore,
} from "./bootstrap-platform-admin.js";

const NOW = new Date("2026-08-05T10:30:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";

class MemoryBootstrapStore implements PlatformAdminBootstrapStore {
  readonly creations: Array<{
    normalizedEmail: string;
    displayEmail: string;
    hostname: string;
    now: Date;
  }> = [];
  private platformAdmin: { userId: string; normalizedEmail: string } | null = null;

  async findPlatformAdmin(): Promise<{ userId: string; normalizedEmail: string } | null> {
    return this.platformAdmin;
  }

  async createPendingPlatformAdmin(input: {
    normalizedEmail: string;
    displayEmail: string;
    hostname: string;
    now: Date;
  }): Promise<{ userId: string }> {
    this.creations.push(input);
    this.platformAdmin = { userId: USER_ID, normalizedEmail: input.normalizedEmail };
    return { userId: USER_ID };
  }
}

test("bootstrap is idempotent for the configured platform-admin email", async () => {
  const store = new MemoryBootstrapStore();

  const first = await bootstrapPlatformAdmin(
    { email: " Admin+Pilot@Example.COM ", hostname: " Console.Example.Test " },
    store,
    { now: () => NOW },
  );
  const second = await bootstrapPlatformAdmin(
    { email: "admin+pilot@example.com", hostname: "console.example.test" },
    store,
    { now: () => new Date("2026-08-05T10:31:00.000Z") },
  );

  assert.deepEqual(first, { userId: USER_ID, created: true });
  assert.deepEqual(second, { userId: USER_ID, created: false });
  assert.deepEqual(store.creations, [
    {
      normalizedEmail: "admin+pilot@example.com",
      displayEmail: "Admin+Pilot@Example.COM",
      hostname: "console.example.test",
      now: NOW,
    },
  ]);
  assert.equal(Object.hasOwn(store.creations[0] ?? {}, "password"), false);
});

test("bootstrap refuses a different email after a platform admin exists", async () => {
  const store = new MemoryBootstrapStore();
  await bootstrapPlatformAdmin(
    { email: "first@example.com", hostname: "console.example.test" },
    store,
    { now: () => NOW },
  );

  await assert.rejects(
    bootstrapPlatformAdmin(
      { email: "second@example.com", hostname: "console.example.test" },
      store,
      { now: () => NOW },
    ),
    (error: unknown) => {
      assert.ok(error instanceof PlatformAdminAlreadyBootstrappedError);
      assert.equal(error.code, "identity.bootstrap.platform_admin_exists");
      assert.doesNotMatch(error.message, /first@example|second@example/iu);
      return true;
    },
  );

  assert.equal(store.creations.length, 1);
});
