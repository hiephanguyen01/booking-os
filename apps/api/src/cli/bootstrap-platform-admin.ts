import { normalizeEmail } from "@booking-os/auth";

export interface PlatformAdminBootstrapRecord {
  readonly userId: string;
  readonly normalizedEmail: string;
}

export interface CreatePendingPlatformAdminInput {
  readonly normalizedEmail: string;
  readonly displayEmail: string;
  readonly hostname: string;
  readonly now: Date;
}

export interface PlatformAdminBootstrapStore {
  findPlatformAdmin(): Promise<PlatformAdminBootstrapRecord | null>;
  createPendingPlatformAdmin(input: CreatePendingPlatformAdminInput): Promise<{ userId: string }>;
}

export interface BootstrapPlatformAdminCommand {
  readonly email: string;
  readonly hostname: string;
}

export interface BootstrapPlatformAdminOptions {
  readonly now?: () => Date;
}

export interface BootstrapPlatformAdminResult {
  readonly userId: string;
  readonly created: boolean;
}

export class PlatformAdminAlreadyBootstrappedError extends Error {
  readonly code = "identity.bootstrap.platform_admin_exists" as const;

  constructor() {
    super("A platform administrator has already been bootstrapped.");
    this.name = "PlatformAdminAlreadyBootstrappedError";
  }
}

function normalizeHostname(input: string): string {
  const hostname = input.trim().normalize("NFC").toLowerCase();
  if (hostname.length === 0) {
    throw new TypeError("Bootstrap hostname cannot be empty.");
  }
  return hostname;
}

export async function bootstrapPlatformAdmin(
  command: BootstrapPlatformAdminCommand,
  store: PlatformAdminBootstrapStore,
  options: BootstrapPlatformAdminOptions = {},
): Promise<BootstrapPlatformAdminResult> {
  const normalizedEmail = normalizeEmail(command.email);
  const displayEmail = command.email.trim().normalize("NFC");
  const hostname = normalizeHostname(command.hostname);
  const existing = await store.findPlatformAdmin();

  if (existing) {
    if (existing.normalizedEmail !== normalizedEmail) {
      throw new PlatformAdminAlreadyBootstrappedError();
    }

    return Object.freeze({ userId: existing.userId, created: false });
  }

  const created = await store.createPendingPlatformAdmin({
    normalizedEmail,
    displayEmail,
    hostname,
    now: (options.now ?? (() => new Date()))(),
  });

  return Object.freeze({ userId: created.userId, created: true });
}
