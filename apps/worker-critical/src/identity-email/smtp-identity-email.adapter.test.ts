import assert from "node:assert/strict";
import test from "node:test";

import { IdentityEmailDeliveryError } from "./identity-email-error.js";
import { SmtpIdentityEmailAdapter } from "./smtp-identity-email.adapter.js";

const MESSAGE = {
  to: "owner@example.com",
  subject: "Activate your Booking OS account",
  text: "Open https://console.example.com/activate#token=redacted",
} as const;

test("submits a text-only identity email with the configured sender", async () => {
  const submissions: unknown[] = [];
  const adapter = new SmtpIdentityEmailAdapter(
    { from: "no-reply@booking.test" },
    {
      async sendMail(input) {
        submissions.push(input);
        return { accepted: [MESSAGE.to] };
      },
    },
  );

  await adapter.send(MESSAGE);

  assert.deepEqual(submissions, [
    {
      from: "no-reply@booking.test",
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    },
  ]);
});

test("classifies temporary and permanent SMTP failures without preserving provider details", async () => {
  for (const [responseCode, code, retryable] of [
    [421, "identity_email.smtp_temporary", true],
    [550, "identity_email.smtp_permanent", false],
  ] as const) {
    const adapter = new SmtpIdentityEmailAdapter(
      { from: "no-reply@booking.test" },
      {
        async sendMail() {
          throw Object.assign(new Error("SMTP rejected token=raw-secret by smtp.internal"), {
            responseCode,
            code: "EENVELOPE",
          });
        },
      },
    );

    await assert.rejects(adapter.send(MESSAGE), (error: unknown) => {
      assert.ok(error instanceof IdentityEmailDeliveryError);
      assert.equal(error.code, code);
      assert.equal(error.retryable, retryable);
      assert.equal(error.message, code);
      assert.doesNotMatch(error.message, /raw-secret|smtp\.internal|EENVELOPE/u);
      return true;
    });
  }
});
