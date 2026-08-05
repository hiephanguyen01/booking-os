export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  needsRehash(hash: string): boolean;
}

export const ARGON2ID_BASELINE = Object.freeze({
  version: 19,
  memoryCostKiB: 65_536,
  timeCost: 3,
  parallelism: 1,
  hashLength: 32,
  saltLength: 16,
});
