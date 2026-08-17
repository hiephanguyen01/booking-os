import assert from "node:assert/strict";
import test from "node:test";

import { createIdentityBffHandlers } from "./identity-bff.js";

test("activation BFF preserves only the server-derived continuation email", async () => {
  let call = 0;
  const handlers = createIdentityBffHandlers({
    apiBaseUrl: "http://127.0.0.1:3001/api",
    fetch: async () => {
      call += 1;
      if (call === 1) {
        return new Response(JSON.stringify({ csrfToken: "proof" }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie":
              "__Host-booking_pre_auth_csrf=nonce; Path=/; HttpOnly; Secure; SameSite=Strict",
          },
        });
      }
      return new Response(
        JSON.stringify({
          completed: true,
          continuationEmail: "owner@example.test",
          invitationToken: "must-not-pass-through",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
  });

  const response = await handlers.activationComplete(
    new Request("https://acme.booking.localhost/api/auth/activation/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://acme.booking.localhost",
      },
      body: JSON.stringify({ token: "selector.secret", newPassword: "safe-password-value" }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    completed: true,
    continuationEmail: "owner@example.test",
  });
});
