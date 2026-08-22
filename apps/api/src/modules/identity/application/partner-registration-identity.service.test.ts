import assert from "node:assert/strict";
import test from "node:test";

import type { GlobalUser } from "../domain/user.js";
import type { PasswordDenylistPort } from "./ports/password-denylist.port.js";
import type { PasswordHasherPort } from "./ports/password-hasher.port.js";
import {
  IdentityUnavailableForPartnerRegistrationError,
  type PartnerRegistrationIdentityPersistencePort,
} from "./partner-registration-identity.contract.js";
import { PartnerRegistrationIdentityService } from "./partner-registration-identity.service.js";

const NOW = new Date("2026-08-23T00:00:00.000Z");
const USER_ID = "11111111-1111-4111-8111-111111111111";
const VALID_PASSWORD = "Valid-Partner-Password-123!";

function createUser(overrides: Partial<GlobalUser> = {}): GlobalUser {
  return Object.freeze({
    id: USER_ID,
    normalizedEmail: "partner@example.test",
    displayEmail: "partner@example.test",
    status: "active",
    authorizationVersion: 7,
    activatedAt: NOW,
    suspendedAt: null,
    disabledAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  });
}

function createPersistence(
  user: GlobalUser | null,
  calls: string[],
): PartnerRegistrationIdentityPersistencePort {
  return {
    async findUserByNormalizedEmail(): Promise<GlobalUser | null> {
      calls.push("find");
      return user;
    },
    async createActiveVerifiedUser(input): Promise<GlobalUser> {
      calls.push("create");
      return createUser({
        normalizedEmail: input.normalizedEmail,
        displayEmail: input.displayEmail,
        authorizationVersion: 1,
      });
    },
    async activatePendingUser(): Promise<GlobalUser> {
      calls.push("activate");
      return createUser();
    },
  };
}

const passwordHasher: PasswordHasherPort = {
  async hash(): Promise<string> {
    return "$argon2id$v=19$m=65536,t=3,p=1$test$hash";
  },
  async verify(): Promise<boolean> {
    return true;
  },
  needsRehash(): boolean {
    return false;
  },
};

const passwordDenylist: PasswordDenylistPort = {
  async contains(): Promise<boolean> {
    return false;
  },
};

test("Partner registration reuses an active identity without mutating credentials", async () => {
  const calls: string[] = [];
  const service = new PartnerRegistrationIdentityService(
    createPersistence(createUser(), calls),
    passwordHasher,
    passwordDenylist,
    () => NOW,
  );

  const result = await service.resolveOrCreateVerifiedIdentity({
    normalizedEmail: "partner@example.test",
    displayEmail: "Partner@example.test",
  });

  assert.deepEqual(result, {
    userId: USER_ID,
    userAuthorizationVersion: 7,
    wasUserCreatedOrActivated: false,
  });
  assert.deepEqual(calls, ["find"]);
});

test("Partner registration fails closed for suspended and disabled identities", async () => {
  for (const status of ["suspended", "disabled"] as const) {
    const service = new PartnerRegistrationIdentityService(
      createPersistence(createUser({ status }), []),
      passwordHasher,
      passwordDenylist,
      () => NOW,
    );

    await assert.rejects(
      () =>
        service.resolveOrCreateVerifiedIdentity({
          normalizedEmail: "partner@example.test",
          displayEmail: "partner@example.test",
          password: VALID_PASSWORD,
        }),
      IdentityUnavailableForPartnerRegistrationError,
    );
  }
});

test("Partner registration requires a valid password before creating or activating an identity", async () => {
  for (const existing of [null, createUser({ status: "pending_activation", activatedAt: null })]) {
    const calls: string[] = [];
    const service = new PartnerRegistrationIdentityService(
      createPersistence(existing, calls),
      passwordHasher,
      passwordDenylist,
      () => NOW,
    );

    await assert.rejects(() =>
      service.resolveOrCreateVerifiedIdentity({
        normalizedEmail: "partner@example.test",
        displayEmail: "partner@example.test",
      }),
    );
    assert.deepEqual(calls, ["find"]);
  }
});
