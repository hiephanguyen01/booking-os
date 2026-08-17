import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeActivationFragment,
  consumeInvitationContinuationFragment,
} from "./fragment-token.js";

class RecordingHistory {
  readonly urls: string[] = [];
  replaceState(_data: unknown, _unused: string, url?: string | URL | null): void {
    this.urls.push(String(url ?? ""));
  }
}

test("consumes exactly one activation/invitation pair and strips it from history", () => {
  const history = new RecordingHistory();
  const result = consumeActivationFragment(
    {
      hash: "#activation=activation.secret&invitation=invitation.secret",
      pathname: "/activate",
      search: "?locale=vi",
    },
    history,
  );

  assert.deepEqual(result, {
    kind: "owner_onboarding",
    activationToken: "activation.secret",
    invitationToken: "invitation.secret",
  });
  assert.deepEqual(history.urls, ["/activate?locale=vi"]);
  assert.equal(JSON.stringify(history.urls).includes("secret"), false);
});

test("rejects partial, duplicated, reordered, or extended onboarding fragments", () => {
  for (const hash of [
    "#activation=a",
    "#invitation=i",
    "#activation=a&activation=b&invitation=i",
    "#invitation=i&activation=a",
    "#activation=a&invitation=i&extra=x",
  ]) {
    const history = new RecordingHistory();
    assert.equal(
      consumeActivationFragment({ hash, pathname: "/activate", search: "" }, history),
      null,
    );
    assert.deepEqual(history.urls, ["/activate"]);
  }
});

test("consumes login invitation continuation without persisting it", () => {
  const history = new RecordingHistory();
  assert.equal(
    consumeInvitationContinuationFragment(
      { hash: "#invitation=invite.secret", pathname: "/login", search: "" },
      history,
    ),
    "invite.secret",
  );
  assert.deepEqual(history.urls, ["/login"]);
});
