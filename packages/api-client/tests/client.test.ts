import assert from "node:assert/strict";
import test from "node:test";

import { createHealthResponseFixture } from "@booking-os/testing";

import {
  ApiClientError,
  createApiClient,
} from "../src/index.js";

async function expectApiClientError(
  operation: () => Promise<unknown>,
  code: ApiClientError["code"],
): Promise<ApiClientError> {
  try {
    await operation();
  } catch (error) {
    assert.ok(error instanceof ApiClientError);
    assert.equal(error.code, code);
    return error;
  }

  assert.fail(`Expected ApiClientError with code ${code}`);
}

test("fetches and validates the typed health response", async () => {
  const expected = createHealthResponseFixture();
  let requestedUrl = "";
  const fetchImplementation: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response(JSON.stringify(expected), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createApiClient({
    baseUrl: "https://api.example.com/v1",
    fetchImplementation,
  });

  const result = await client.health.get();

  assert.deepEqual(result, expected);
  assert.equal(requestedUrl, "https://api.example.com/v1/health");
});

test("classifies non-success HTTP responses", async () => {
  const fetchImplementation: typeof fetch = async () =>
    new Response("unavailable", { status: 503 });
  const client = createApiClient({
    baseUrl: "https://api.example.com",
    fetchImplementation,
  });

  const error = await expectApiClientError(() => client.health.get(), "http");

  assert.equal(error.status, 503);
});

test("rejects invalid health response shapes", async () => {
  const fetchImplementation: typeof fetch = async () =>
    new Response(JSON.stringify({ status: "ok" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const client = createApiClient({
    baseUrl: "https://api.example.com",
    fetchImplementation,
  });

  await expectApiClientError(() => client.health.get(), "invalid_response");
});

test("rejects invalid configuration before fetching", () => {
  assert.throws(
    () => createApiClient({ baseUrl: "ftp://api.example.com" }),
    (error: unknown) =>
      error instanceof ApiClientError && error.code === "invalid_config",
  );
  assert.throws(
    () => createApiClient({ baseUrl: "not a url" }),
    (error: unknown) =>
      error instanceof ApiClientError && error.code === "invalid_config",
  );
  assert.throws(
    () => createApiClient({ baseUrl: "https://api.example.com", timeoutMs: 0 }),
    (error: unknown) =>
      error instanceof ApiClientError && error.code === "invalid_config",
  );
});

test("classifies network failures and preserves the cause", async () => {
  const cause = new Error("offline");
  const fetchImplementation: typeof fetch = async () => {
    throw cause;
  };
  const client = createApiClient({
    baseUrl: "https://api.example.com",
    fetchImplementation,
  });

  const error = await expectApiClientError(() => client.health.get(), "network");

  assert.equal(error.cause, cause);
  assert.equal(Object.hasOwn(error, "status"), false);
});

test("aborts requests after the configured timeout", async () => {
  const fetchImplementation: typeof fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  const client = createApiClient({
    baseUrl: "https://api.example.com",
    fetchImplementation,
    timeoutMs: 5,
  });

  await expectApiClientError(() => client.health.get(), "timeout");
});
