import assert from "node:assert/strict";
import test from "node:test";

import { ARGON2ID_BASELINE, type PasswordHasher } from "../src/password-hasher.js";

test("exports the approved Argon2id baseline", () => {
  assert.deepEqual(ARGON2ID_BASELINE, {
    version: 19,
    memoryCostKiB: 65_536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
    saltLength: 16,
  });
  assert.equal(Object.isFrozen(ARGON2ID_BASELINE), true);
});

test("defines a framework-neutral password hasher contract", async () => {
  const hasher: PasswordHasher = {
    async hash(password) {
      return `hashed:${password}`;
    },
    async verify(hash, password) {
      return hash === `hashed:${password}`;
    },
    needsRehash(hash) {
      return !hash.startsWith("hashed:");
    },
  };

  const hash = await hasher.hash("correct horse battery staple");

  assert.equal(await hasher.verify(hash, "correct horse battery staple"), true);
  assert.equal(hasher.needsRehash(hash), false);
});
