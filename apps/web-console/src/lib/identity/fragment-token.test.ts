import assert from "node:assert/strict";
import test from "node:test";

import { consumeIdentityTokenFragment } from "./fragment-token.js";

class RecordingHistory {
  readonly calls: Array<{
    data: unknown;
    unused: string;
    url: string | URL | null | undefined;
  }> = [];

  replaceState(data: unknown, unused: string, url?: string | URL | null): void {
    this.calls.push({ data, unused, url });
  }
}

class LiveLocationHistory extends RecordingHistory {
  constructor(private readonly location: { hash: string }) {
    super();
  }

  override replaceState(data: unknown, unused: string, url?: string | URL | null): void {
    super.replaceState(data, unused, url);
    this.location.hash = "";
  }
}

test("reads the identity token once and removes the fragment from the address bar", () => {
  const history = new RecordingHistory();
  const token = consumeIdentityTokenFragment(
    {
      hash: "#token=selector.secret-value",
      pathname: "/activate",
      search: "",
    },
    history,
  );

  assert.equal(token, "selector.secret-value");
  assert.deepEqual(history.calls, [{ data: null, unused: "", url: "/activate" }]);
  assert.equal(JSON.stringify(history.calls).includes("selector.secret-value"), false);
});

test("snapshots a live location fragment before replaceState mutates it", () => {
  const location = {
    hash: "#token=live-selector.live-secret",
    pathname: "/activate",
    search: "",
  };
  const history = new LiveLocationHistory(location);

  assert.equal(consumeIdentityTokenFragment(location, history), "live-selector.live-secret");
  assert.equal(location.hash, "");
  assert.deepEqual(history.calls, [{ data: null, unused: "", url: "/activate" }]);
});

test("rejects ambiguous fragments and never moves a token into the query string", () => {
  const history = new RecordingHistory();

  assert.equal(
    consumeIdentityTokenFragment(
      {
        hash: "#token=first&token=second",
        pathname: "/password/reset",
        search: "?locale=vi",
      },
      history,
    ),
    null,
  );
  assert.deepEqual(history.calls, [{ data: null, unused: "", url: "/password/reset?locale=vi" }]);
  assert.equal(JSON.stringify(history.calls).includes("token="), false);
});
