export class ReadinessTimeoutError extends Error {
  constructor() {
    super("Readiness probe timed out");
    this.name = "ReadinessTimeoutError";
  }
}

export interface ReadinessTimerScheduler {
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}

const systemTimerScheduler: ReadinessTimerScheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function withReadinessTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  scheduler: ReadinessTimerScheduler = systemTimerScheduler,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timerHandle: unknown;

    const settle = (action: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      scheduler.clear(timerHandle);
      action();
    };

    timerHandle = scheduler.set(() => settle(() => reject(new ReadinessTimeoutError())), timeoutMs);

    operation.then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}
