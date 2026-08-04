import assert from "node:assert/strict";
import test from "node:test";

import {
  ReadinessTimeoutError,
  type ReadinessTimerScheduler,
  withReadinessTimeout,
} from "./readiness-timeout.js";

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function createScheduler() {
  const handle = Symbol("readiness-timer");
  let callback: (() => void) | undefined;
  let delayMs: number | undefined;
  let clearCount = 0;

  const scheduler: ReadinessTimerScheduler = {
    set(next, delay) {
      callback = next;
      delayMs = delay;
      return handle;
    },
    clear(value) {
      assert.equal(value, handle);
      clearCount += 1;
    },
  };

  return {
    scheduler,
    fire() {
      assert.ok(callback);
      callback();
    },
    get delayMs() {
      return delayMs;
    },
    get clearCount() {
      return clearCount;
    },
  };
}

test("returns the underlying value and clears its timer", async () => {
  const deferred = createDeferred<string>();
  const timer = createScheduler();
  const result = withReadinessTimeout(deferred.promise, 750, timer.scheduler);

  deferred.resolve("ready");

  assert.equal(await result, "ready");
  assert.equal(timer.delayMs, 750);
  assert.equal(timer.clearCount, 1);
});

test("preserves an immediate underlying rejection and clears its timer", async () => {
  const deferred = createDeferred<string>();
  const timer = createScheduler();
  const expected = new Error("probe failed");
  const result = withReadinessTimeout(deferred.promise, 750, timer.scheduler);

  deferred.reject(expected);

  await assert.rejects(result, (error) => error === expected);
  assert.equal(timer.clearCount, 1);
});

test("rejects at the deadline with a safe timeout error", async () => {
  const deferred = createDeferred<string>();
  const timer = createScheduler();
  const result = withReadinessTimeout(deferred.promise, 750, timer.scheduler);

  timer.fire();

  await assert.rejects(result, (error) => {
    assert.ok(error instanceof ReadinessTimeoutError);
    assert.equal(error.message, "Readiness probe timed out");
    return true;
  });
  assert.equal(timer.clearCount, 1);
});

test("handles a late underlying rejection after the timeout wins", { concurrency: false }, async () => {
  const deferred = createDeferred<string>();
  const timer = createScheduler();
  const result = withReadinessTimeout(deferred.promise, 750, timer.scheduler);
  let unhandled: unknown;
  const captureUnhandled = (reason: unknown) => {
    unhandled = reason;
  };

  process.once("unhandledRejection", captureUnhandled);

  try {
    timer.fire();
    await assert.rejects(result, ReadinessTimeoutError);

    deferred.reject(new Error("late failure"));
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(unhandled, undefined);
    assert.equal(timer.clearCount, 1);
  } finally {
    process.removeListener("unhandledRejection", captureUnhandled);
  }
});
