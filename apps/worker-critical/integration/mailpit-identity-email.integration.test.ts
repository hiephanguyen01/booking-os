import assert from "node:assert/strict";
import test from "node:test";

import { IdentityEmailDispatcher } from "../src/identity-email/identity-email-dispatcher.js";
import { IdentityEmailDeliveryError } from "../src/identity-email/identity-email-error.js";
import {
  NodeSmtpTransport,
  SmtpIdentityEmailAdapter,
} from "../src/identity-email/smtp-identity-email.adapter.js";
import { createIdentityEmailJob, TOKEN } from "../src/identity-email/test-fixtures.js";

const MAILPIT_API_URL = process.env.MAILPIT_API_URL ?? "http://127.0.0.1:8025";
const MAILPIT_SMTP_HOST = process.env.MAILPIT_SMTP_HOST ?? "127.0.0.1";
const MAILPIT_SMTP_PORT = Number(process.env.MAILPIT_SMTP_PORT ?? "1025");
const SMTP_FROM = "no-reply@booking.test";

interface MailpitMessageSummary {
  readonly ID: string;
  readonly Subject: string;
}

function parseMessageSummaries(value: unknown): readonly MailpitMessageSummary[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const messages = (value as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) {
    return [];
  }

  return messages.flatMap((message): MailpitMessageSummary[] => {
    if (!message || typeof message !== "object") {
      return [];
    }

    const id = (message as { ID?: unknown }).ID;
    const subject = (message as { Subject?: unknown }).Subject;
    return typeof id === "string" && typeof subject === "string"
      ? [{ ID: id, Subject: subject }]
      : [];
  });
}

async function mailpit(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${MAILPIT_API_URL}${path}`, init);
  assert.equal(response.ok, true, `Mailpit request failed: ${response.status} ${path}`);
  return response;
}

async function clearMailbox(): Promise<void> {
  await mailpit("/api/v1/messages", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

async function waitForMessages(expected: number): Promise<readonly MailpitMessageSummary[]> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const response = await mailpit("/api/v1/messages?limit=10");
    const messages = parseMessageSummaries(await response.json());
    if (messages.length === expected) {
      return messages;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.fail(`Expected ${expected} messages in Mailpit.`);
}

function createDispatcher(port = MAILPIT_SMTP_PORT): IdentityEmailDispatcher {
  const transport = new NodeSmtpTransport({
    host: MAILPIT_SMTP_HOST,
    port,
    secure: false,
    from: SMTP_FROM,
  });
  const sender = new SmtpIdentityEmailAdapter({ from: SMTP_FROM }, transport);
  return new IdentityEmailDispatcher(sender, createIdentityEmailJob().keyring);
}

test("delivers activation and reset emails through Mailpit with tokens only in URL fragments", async () => {
  await clearMailbox();
  const dispatcher = createDispatcher();
  const activation = createIdentityEmailJob();
  const reset = createIdentityEmailJob({
    eventType: "identity.password_reset.requested.v1",
    template: "password_reset",
  });

  await dispatcher.dispatch(activation.name, activation.data);
  await dispatcher.dispatch(reset.name, reset.data);

  const messages = await waitForMessages(2);
  const rawBySubject = new Map<string, string>();
  for (const message of messages) {
    const raw = await mailpit(`/api/v1/message/${encodeURIComponent(message.ID)}/raw`);
    rawBySubject.set(message.Subject, await raw.text());
  }

  const activationRaw = rawBySubject.get("Activate your Booking OS account") ?? "";
  const resetRaw = rawBySubject.get("Reset your Booking OS password") ?? "";
  const encodedToken = encodeURIComponent(TOKEN);
  const ciphertext = activation.data.payload.envelope.ciphertext;

  assert.match(activationRaw, /From: no-reply@booking\.test/u);
  assert.match(activationRaw, /To: owner@example\.com/u);
  assert.match(activationRaw, /Content-Type: text\/plain; charset=UTF-8/u);
  assert.match(
    activationRaw,
    new RegExp(`https://console\\.example\\.com/activate#token=${encodedToken}`, "u"),
  );
  assert.match(
    resetRaw,
    new RegExp(`https://console\\.example\\.com/password/reset#token=${encodedToken}`, "u"),
  );

  for (const raw of [activationRaw, resetRaw]) {
    assert.doesNotMatch(raw, /\?token=/u);
    assert.doesNotMatch(raw, /<img|tracking/iu);
    assert.equal(raw.includes(ciphertext), false);
  }
});

test("real network failures preserve retry classification without exposing token material", async () => {
  const dispatcher = createDispatcher(1);
  const job = createIdentityEmailJob();

  await assert.rejects(dispatcher.dispatch(job.name, job.data), (error: unknown) => {
    assert.ok(error instanceof IdentityEmailDeliveryError);
    assert.equal(error.code, "identity_email.smtp_temporary");
    assert.equal(error.retryable, true);
    assert.equal(error.message, "identity_email.smtp_temporary");
    assert.doesNotMatch(error.message, new RegExp(TOKEN, "u"));
    assert.doesNotMatch(error.message, /ciphertext|ECONNREFUSED|127\.0\.0\.1/iu);
    return true;
  });
});
