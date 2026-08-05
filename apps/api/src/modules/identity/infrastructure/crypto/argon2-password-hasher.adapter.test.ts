import assert from "node:assert/strict";
import test from "node:test";

import {
  Argon2PasswordHasherAdapter,
  type Argon2PasswordHasherOptions,
} from "./argon2-password-hasher.adapter.js";

const PASSWORD = "correct horse battery staple";
const BASELINE_OPTIONS: Argon2PasswordHasherOptions = {
  version: 19,
  memoryCostKiB: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
};

test("encodes the approved Argon2id baseline and verifies passwords", async () => {
  const adapter = new Argon2PasswordHasherAdapter();

  const hash = await adapter.hash(PASSWORD);

  assert.match(hash, /^\$argon2id\$v=19\$m=65536,t=3,p=1\$/);
  assert.equal(await adapter.verify(hash, PASSWORD), true);
  assert.equal(await adapter.verify(hash, "incorrect password"), false);
  assert.equal(adapter.needsRehash(hash), false);
});

test("reports hashes with weaker parameters for rehashing", async () => {
  const weakAdapter = new Argon2PasswordHasherAdapter({
    ...BASELINE_OPTIONS,
    memoryCostKiB: 8_192,
    timeCost: 1,
  });
  const baselineAdapter = new Argon2PasswordHasherAdapter();
  const weakHash = await weakAdapter.hash(PASSWORD);

  assert.equal(await baselineAdapter.verify(weakHash, PASSWORD), true);
  assert.equal(baselineAdapter.needsRehash(weakHash), true);
});

test("fails closed for malformed hashes without exposing the password", async () => {
  const adapter = new Argon2PasswordHasherAdapter();
  const sensitivePassword = "never include this password in an error";

  await assert.doesNotReject(async () => {
    assert.equal(await adapter.verify("not-an-argon2-hash", sensitivePassword), false);
  });
  assert.equal(adapter.needsRehash("not-an-argon2-hash"), true);
});
