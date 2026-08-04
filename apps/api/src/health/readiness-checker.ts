import { createConnection } from "node:net";
import { performance } from "node:perf_hooks";

import type { HealthDependencyStatus } from "@booking-os/contracts/health";
import { Inject, Injectable } from "@nestjs/common";

import { EnvironmentService } from "../config/environment.service.js";

const READINESS_TIMEOUT_MS = 1000;

export interface ReadinessDependencies
  extends Readonly<Record<string, HealthDependencyStatus>> {
  readonly postgres: HealthDependencyStatus;
  readonly redis: HealthDependencyStatus;
}

export abstract class DependencyProbe {
  abstract check(url: string, timeoutMs: number): Promise<HealthDependencyStatus>;
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
export class ReadinessChecker {
  constructor(
    @Inject(EnvironmentService)
    private readonly environment: EnvironmentService,
    @Inject(DependencyProbe)
    private readonly probe: DependencyProbe,
  ) {}

  async check(): Promise<ReadinessDependencies> {
    const [postgres, redis] = await Promise.all([
      this.probe.check(this.environment.databaseUrl, READINESS_TIMEOUT_MS),
      this.probe.check(this.environment.redisUrl, READINESS_TIMEOUT_MS),
    ]);

    return { postgres, redis };
  }
}
