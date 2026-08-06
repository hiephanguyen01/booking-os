import assert from "node:assert/strict";
import test from "node:test";

import * as argon2 from "argon2";

import type { PrismaService } from "../../../../../database/prisma.service.js";
import { PrismaCredentialVerifierAdapter } from "./prisma-credential-verifier.adapter.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";

interface CapturedUpdate {
  readonly where: { readonly userId: string };
  readonly data: Readonly<Record<string, unknown>>;
}

test("rehashes Argon2 parameters without recording a user password change", async () => {
  const updates: CapturedUpdate[] = [];
  const prisma = {
    passwordCredential: {
      async update(input: CapturedUpdate): Promise<void> {
        updates.push(input);
      },
    },
  } as unknown as PrismaService;
  const adapter = new PrismaCredentialVerifierAdapter(prisma);

  await adapter.rehashPassword({ userId: USER_ID, password: "correct horse battery staple" });

  const updateInput = updates[0];
  assert.ok(updateInput);
  assert.deepEqual(updateInput.where, { userId: USER_ID });
  assert.equal(updateInput.data.algorithm, "argon2id");
  assert.equal("passwordChangedAt" in updateInput.data, false);
  assert.equal(typeof updateInput.data.passwordHash, "string");
  assert.equal(
    await argon2.verify(updateInput.data.passwordHash as string, "correct horse battery staple"),
    true,
  );
});
