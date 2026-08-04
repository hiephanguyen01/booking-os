import { createConnection } from "node:net";
import { performance } from "node:perf_hooks";

import type { HealthDependencyStatus } from "@booking-os/contracts/health";
import { Inject, Injectable } from "@nestjs/common";

import { EnvironmentService } from "../config/environment.service.js";
import { PrismaService } from "../database/prisma.service.js";

const READINESS_TIMEOUT_MS = 1000;

export interface ReadinessDependencies extends Readonly<Record<string, HealthDependencyStatus>> {
  readonly postgres: HealthDependencyStatus;
  readonly redis: HealthDependencyStatus;
}

export abstract class DependencyProbe {
  abstract check(url: string, timeoutMs: number): Promise<HealthDependencyStatus>;
}

export abstract class PostgresDependencyProbe {
  abstract check(timeoutMs: number): Promise<HealthDependencyStatus>;
}

function resolvePort(url: URL): number {
  if (url.port.length > 0) {
    return Number(url.port);
  }

  return url.protocol === "redis:" || url.protocol === "rediss:" ? 6379 : 5432;
}

@Injectable()
export class TcpDependencyProbe extends DependencyProbe {
  async check(urlValue: string, timeoutMs: number): Promise<HealthDependencyStatus> {
    let url: URL;

    try {
      url = new URL(urlValue);
    } catch {
      return { status: "unavailable", message: "invalid_url" };
    }

    const startedAt = performance.now();

    return new Promise((resolve) => {
      const socket = createConnection({
        host: url.hostname,
        port: resolvePort(url),
      });
      let settled = false;

      const finish = (status: HealthDependencyStatus["status"], message?: string): void => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();

        resolve({
          status,
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          ...(message === undefined ? {} : { message }),
        });
      };

      socket.setTimeout(timeoutMs);
      socket.once("connect", () => finish("ok"));
      socket.once("timeout", () => finish("unavailable", "timeout"));
      socket.once("error", () => finish("unavailable", "connection_failed"));
    });
  }
}

@Injectable()
export class PrismaPostgresDependencyProbe extends PostgresDependencyProbe {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {
    super();
  }

  async check(timeoutMs: number): Promise<HealthDependencyStatus> {
    const startedAt = performance.now();
    let timeout: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        this.prisma.ping(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("timeout")), timeoutMs);
        }),
      ]);

      return {
        status: "ok",
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      };
    } catch (error: unknown) {
      return {
        status: "unavailable",
        latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
        message:
          error instanceof Error && error.message === "timeout" ? "timeout" : "connection_failed",
      };
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}

@Injectable()
export class ReadinessChecker {
  constructor(
    @Inject(EnvironmentService)
    private readonly environment: EnvironmentService,
    @Inject(DependencyProbe)
    private readonly redisProbe: DependencyProbe,
    @Inject(PostgresDependencyProbe)
    private readonly postgresProbe: PostgresDependencyProbe,
  ) {}

  async check(): Promise<ReadinessDependencies> {
    const [postgres, redis] = await Promise.all([
      this.postgresProbe.check(READINESS_TIMEOUT_MS),
      this.redisProbe.check(this.environment.redisUrl, READINESS_TIMEOUT_MS),
    ]);

    return { postgres, redis };
  }
}
