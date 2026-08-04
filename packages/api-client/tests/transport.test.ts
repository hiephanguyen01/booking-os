import assert from "node:assert/strict";
import test from "node:test";

import { ApiClientError } from "../src/errors.js";
import { createFetchTransport } from "../src/transport.js";

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

test("serializes URL, query, headers, credentials, request ID, and JSON body", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const fetchImplementation: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedInit = init;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const transport = createFetchTransport({
    baseUrl: "https://api.example.com/v1",
    credentials: "include",
    defaultHeaders: {
      "content-type": "text/plain",
      "x-client": "default",
    },
    fetchImplementation,
    requestId: () => "request-123",
  });

  const result = await transport<{ readonly ok: true }>({
    body: { name: "Studio" },
    headers: {
      "content-type": "application/xml",
      "x-client": "operation",
      "x-operation": "yes",
    },
    method: "POST",
    path: "/widgets/abc",
    query: {
      absent: undefined,
      count: 2,
      dryRun: true,
      tags: ["a", "b"],
    },
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(
    requestedUrl,
    "https://api.example.com/v1/widgets/abc?count=2&dryRun=true&tags=a&tags=b",
  );
  assert.equal(requestedInit?.method, "POST");
  assert.equal(requestedInit?.credentials, "include");
  assert.equal(requestedInit?.body, JSON.stringify({ name: "Studio" }));

  const headers = new Headers(requestedInit?.headers);
  assert.equal(headers.get("accept"), "application/json");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(headers.get("x-client"), "operation");
  assert.equal(headers.get("x-operation"), "yes");
  assert.equal(headers.get("x-request-id"), "request-123");
});

test("classifies HTTP and invalid JSON responses", async () => {
  const httpTransport = createFetchTransport({
    baseUrl: "https://api.example.com",
    fetchImplementation: async () => new Response("unavailable", { status: 503 }),
  });
  const httpError = await expectApiClientError(
    () => httpTransport({ method: "GET", path: "/ready" }),
    "http",
  );
  assert.equal(httpError.status, 503);

  const invalidJsonTransport = createFetchTransport({
    baseUrl: "https://api.example.com",
    fetchImplementation: async () =>
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  await expectApiClientError(
    () => invalidJsonTransport({ method: "GET", path: "/health" }),
    "invalid_response",
  );
});

test("classifies network failures and preserves the cause", async () => {
  const cause = new Error("offline");
  const transport = createFetchTransport({
    baseUrl: "https://api.example.com",
    fetchImplementation: async () => {
      throw cause;
    },
  });

  const error = await expectApiClientError(
    () => transport({ method: "GET", path: "/health" }),
    "network",
  );
  assert.equal(error.cause, cause);
});

test("aborts requests after the configured timeout", async () => {
  const transport = createFetchTransport({
    baseUrl: "https://api.example.com",
    fetchImplementation: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      }),
    timeoutMs: 5,
  });

  await expectApiClientError(
    () => transport({ method: "GET", path: "/health" }),
    "timeout",
  );
});

test("rejects invalid transport configuration before fetching", () => {
  assert.throws(
    () => createFetchTransport({ baseUrl: "ftp://api.example.com" }),
    (error: unknown) => error instanceof ApiClientError && error.code === "invalid_config",
  );
  assert.throws(
    () => createFetchTransport({ baseUrl: "not a url" }),
    (error: unknown) => error instanceof ApiClientError && error.code === "invalid_config",
  );
  assert.throws(
    () => createFetchTransport({ baseUrl: "https://api.example.com", timeoutMs: 0 }),
    (error: unknown) => error instanceof ApiClientError && error.code === "invalid_config",
  );
});
